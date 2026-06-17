// Compat-shim version of temporal_capi's diplomat_runtime.hpp.
//
// V8's `js-temporal-objects.cc` (~7142 LOC, ~459 call sites) was
// written against the diplomat-generated FFI bindings shipped with
// the `temporal_rs` Rust crate. This header (and its sibling type
// headers under `temporal_rs/`) provides a drop-in replacement that
// resolves to our C++-native temporal-infra port, eliminating the
// rustc/cargo build dependency.
//
// Surface required by V8:
//   - temporal_rs::diplomat::Ok / Err / result<T, E>
//   - temporal_rs::diplomat::span<T> for slice arguments
//   - U8 / U16 / Char string-view helpers (only the typedefs;
//     V8 doesn't actually exercise the C-FFI representation
//     because there's no FFI boundary in this shim)
//
// We stay strictly below `temporal_rs::diplomat::` here. Type-level
// shims for `temporal_rs::Instant`, `temporal_rs::PlainDate`, etc.
// live in their own headers in this directory.

#ifndef TEMPORAL_RS_COMPAT_DIPLOMAT_RUNTIME_HPP_
#define TEMPORAL_RS_COMPAT_DIPLOMAT_RUNTIME_HPP_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <type_traits>
#include <variant>

#if __cplusplus >= 202002L
#  include <span>
#endif

namespace temporal_rs {
namespace diplomat {

// ── result<T, E> primitives ───────────────────────────────────────────

template <class T>
struct Ok {
  T inner;
  template <class U,
            std::enable_if_t<std::is_constructible_v<T, U&&>, int> = 0>
  explicit Ok(U&& v) : inner(std::forward<U>(v)) {}
  Ok() : inner() {}
};

template <class E>
struct Err {
  E inner;
  template <class U,
            std::enable_if_t<std::is_constructible_v<E, U&&>, int> = 0>
  explicit Err(U&& v) : inner(std::forward<U>(v)) {}
  Err() : inner() {}
};

template <class T, class E>
class result {
 public:
  result(Ok<T>&& v) : val_(std::move(v)) {}
  result(Err<E>&& v) : val_(std::move(v)) {}
  result() = default;
  result(const result&) = default;
  result& operator=(const result&) = default;
  result(result&&) noexcept = default;
  result& operator=(result&&) noexcept = default;

  bool is_ok() const { return std::holds_alternative<Ok<T>>(val_); }
  bool is_err() const { return std::holds_alternative<Err<E>>(val_); }

  template <typename U = T,
            typename std::enable_if_t<!std::is_reference_v<U>,
                                       std::nullptr_t> = nullptr>
  std::optional<T> ok() && {
    if (!is_ok()) {
      return std::nullopt;
    }
    return std::make_optional(
        std::move(std::get<Ok<T>>(std::move(val_)).inner));
  }

  template <typename U = E,
            typename std::enable_if_t<!std::is_reference_v<U>,
                                       std::nullptr_t> = nullptr>
  std::optional<E> err() && {
    if (!is_err()) {
      return std::nullopt;
    }
    return std::make_optional(
        std::move(std::get<Err<E>>(std::move(val_)).inner));
  }

  void set_ok(T&& t) { val_ = Ok<T>(std::move(t)); }
  void set_err(E&& e) { val_ = Err<E>(std::move(e)); }

 protected:
  std::variant<Ok<T>, Err<E>> val_;
};

// ── span<T> ───────────────────────────────────────────────────────────

#if __cplusplus >= 202002L

template <class T>
using span = std::span<T>;

#else

template <class T>
class span {
 public:
  span() noexcept : data_(nullptr), size_(0) {}
  span(T* data, size_t size) noexcept : data_(data), size_(size) {}
  template <size_t N>
  span(T (&arr)[N]) noexcept : data_(arr), size_(N) {}

  T* data() const noexcept { return data_; }
  size_t size() const noexcept { return size_; }
  T* begin() const noexcept { return data_; }
  T* end() const noexcept { return data_ + size_; }
  T& operator[](size_t i) const noexcept { return data_[i]; }

 private:
  T* data_;
  size_t size_;
};

#endif

// ── U16 string-view stub ──────────────────────────────────────────────
//
// Some V8 call sites pass `std::u16string_view` (the spec's UTF-16
// arg shape). The shim accepts these by transcoding to UTF-8 at the
// boundary. The actual transcoding happens in the type wrappers; we
// just need the typedef here so V8's headers parse.

using u16string_view = std::u16string_view;

}  // namespace diplomat
}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_DIPLOMAT_RUNTIME_HPP_
