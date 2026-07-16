// Compat shim: temporal_rs::DateDuration — heap-owned wrapper around
// node::socketsecurity::temporal::DateDuration. Diplomat-shaped:
// factories return result<unique_ptr<DateDuration>, TemporalError>;
// the class itself is non-copyable / non-movable.
//
// `temporal_rs::` is preserved as the V8-facing namespace name even
// though there's no Rust in this layer — see README.md for the
// rationale.
//
// Upstream surface mirrored:
//   upstream/temporal/temporal_capi/bindings/cpp/temporal_rs/DateDuration.hpp
//     class DateDuration {
//       static diplomat::result<unique_ptr<DateDuration>, TemporalError>
//         try_new(int64_t years, int64_t months, int64_t weeks, int64_t days);
//       unique_ptr<DateDuration> abs() const;
//       unique_ptr<DateDuration> negated() const;
//       Sign sign() const;
//     };
//
// Spec reference:
//   js-temporal/temporal-polyfill/tree/rebase-part3/lib/internaltypes.d.ts
//     export interface DateDuration {
//       years: number; months: number; weeks: number; days: number;
//     }
//   js-temporal/temporal-polyfill/tree/rebase-part3/lib/duration.ts
//     (used as date-only component of an InternalDuration record).
//
// Infra backing:
//   src/socketsecurity/temporal/duration_normalized.h
//     struct DateDuration { i64 years/months/weeks/days; Negated();
//                            Abs(); GetSign(); static New(...); };
//   The infra layer's DateDuration is a 32-byte POD value type. The
//   shim wraps it in a heap-allocated object so V8 sees the
//   diplomat-standard unique_ptr return shape.

#ifndef TEMPORAL_RS_COMPAT_DATEDURATION_HPP_
#define TEMPORAL_RS_COMPAT_DATEDURATION_HPP_

#include <cstdint>
#include <memory>

#include "socketsecurity/temporal/duration_normalized.h"
#include "temporal_rs/Sign.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class DateDuration {
 public:
  static diplomat::result<std::unique_ptr<DateDuration>, TemporalError>
  try_new(int64_t years, int64_t months, int64_t weeks, int64_t days) {
    auto r = ::node::socketsecurity::temporal::DateDuration::New(
        years, months, weeks, days);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<DateDuration>>(
        std::unique_ptr<DateDuration>(new DateDuration(r.value())));
  }

  std::unique_ptr<DateDuration> abs() const {
    return std::unique_ptr<DateDuration>(new DateDuration(inner_.Abs()));
  }

  std::unique_ptr<DateDuration> negated() const {
    return std::unique_ptr<DateDuration>(new DateDuration(inner_.Negated()));
  }

  Sign sign() const { return Sign::FromInfra(inner_.GetSign()); }

  const ::node::socketsecurity::temporal::DateDuration& ToInfra() const noexcept {
    return inner_;
  }

 private:
  explicit DateDuration(
      ::node::socketsecurity::temporal::DateDuration inner) noexcept
      : inner_(inner) {}
  DateDuration(const DateDuration&) = delete;
  DateDuration& operator=(const DateDuration&) = delete;
  DateDuration(DateDuration&&) = delete;
  DateDuration& operator=(DateDuration&&) = delete;

  ::node::socketsecurity::temporal::DateDuration inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_DATEDURATION_HPP_
