// Compat shim: temporal_rs::OwnedRelativeTo. Upstream models this as a
// pair of optional unique_ptrs (`date` xor `zoned`); V8 reads the two
// fields directly via `.date` / `.zoned`. We mirror the struct layout
// exactly so V8's source compiles unchanged.

#ifndef TEMPORAL_RS_COMPAT_OWNEDRELATIVETO_HPP_
#define TEMPORAL_RS_COMPAT_OWNEDRELATIVETO_HPP_

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/relative_to.h"
#include "temporal_rs/PlainDate.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/RelativeTo.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/ZonedDateTime.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

struct OwnedRelativeTo {
  std::unique_ptr<PlainDate> date;
  std::unique_ptr<ZonedDateTime> zoned;

  // Default-constructible so V8 can declare `OwnedRelativeTo r;` and
  // assign into it via MOVE_RETURN_ON_EXCEPTION.
  OwnedRelativeTo() = default;
  OwnedRelativeTo(const OwnedRelativeTo&) = delete;
  OwnedRelativeTo& operator=(const OwnedRelativeTo&) = delete;
  OwnedRelativeTo(OwnedRelativeTo&&) noexcept = default;
  OwnedRelativeTo& operator=(OwnedRelativeTo&&) noexcept = default;

  // Empty / sentinel value upstream returns when no relativeTo was
  // specified - both fields null.
  static OwnedRelativeTo empty() { return OwnedRelativeTo{}; }

  // Spec: parse the input and produce either a PlainDate or a
  // ZonedDateTime depending on whether the IXDTF string carried a
  // timezone annotation. Routes through the underlying parsers; the
  // Provider arg is a marker since the C++ port's TimeZoneBackend
  // already handles IANA resolution.
  static diplomat::result<OwnedRelativeTo, TemporalError> from_utf8(
      std::string_view s) {
    // Try ZonedDateTime first - it accepts a superset of the PlainDate
    // syntax (anything with `[...]` is a ZDT). On failure, fall back to
    // PlainDate.
    auto zdt_r = ZonedDateTime::from_utf8(s);
    if (zdt_r.is_ok()) {
      OwnedRelativeTo out;
      out.zoned = std::move(*std::move(zdt_r).ok());
      return diplomat::Ok<OwnedRelativeTo>(std::move(out));
    }
    auto pd_r = PlainDate::from_utf8(s);
    if (pd_r.is_ok()) {
      OwnedRelativeTo out;
      out.date = std::move(*std::move(pd_r).ok());
      return diplomat::Ok<OwnedRelativeTo>(std::move(out));
    }
    // Surface the more-informative ZDT-path error if both fail.
    auto err = std::move(pd_r).err();
    if (err.has_value()) {
      return diplomat::Err<TemporalError>(std::move(*err));
    }
    return diplomat::Err<TemporalError>(TemporalError{
        ErrorKind::Range, "Invalid OwnedRelativeTo string"});
  }

  static diplomat::result<OwnedRelativeTo, TemporalError>
  from_utf8_with_provider(std::string_view s, const Provider& /*p*/) {
    return from_utf8(s);
  }

  static diplomat::result<OwnedRelativeTo, TemporalError> from_utf16(
      std::u16string_view s) {
    std::string narrow;
    narrow.reserve(s.size());
    for (char16_t c : s) {
      if (c > 0x7F) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range,
            "Non-ASCII character in OwnedRelativeTo string"});
      }
      narrow.push_back(static_cast<char>(c));
    }
    return from_utf8(narrow);
  }

  static diplomat::result<OwnedRelativeTo, TemporalError>
  from_utf16_with_provider(std::u16string_view s, const Provider& /*p*/) {
    return from_utf16(s);
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_OWNEDRELATIVETO_HPP_
