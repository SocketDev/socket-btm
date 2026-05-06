// 1:1 port of upstream `src/parsed_intermediates.rs` at temporal v0.2.3
// (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Holds parsed-but-not-validated structures produced by the IXDTF parser
// (parse.cc). The spec calls for parse → validate to be observable
// separately, so these types are public but never escape Temporal's
// internal layer.
//
// Names match upstream 1:1 (`ParsedDate`, `ParsedDateTime`,
// `ParsedZonedDateTime`). Parser-level output uses `ParseDateTimeRecord`
// (see parse.h) so it doesn't shadow the spec-level intermediate types.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_PARSED_INTERMEDIATES_H_
#define SRC_SOCKETSECURITY_TEMPORAL_PARSED_INTERMEDIATES_H_

#include <cstddef>
#include <cstdint>

#include "socketsecurity/temporal/error.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Forward decls — the calendar / time-zone classes haven't landed yet.
class Calendar;
class TimeZone;
class UtcOffset;

// Mirror of upstream's `DateRecord` (a parsed-but-not-validated date).
struct ParsedDateRecord {
  int32_t year = 0;
  uint8_t month = 0;
  uint8_t day = 0;
};

// Mirror of upstream's `IsoTime` (a parsed-but-not-validated time).
struct ParsedTime {
  uint8_t hour = 0;
  uint8_t minute = 0;
  uint8_t second = 0;
  uint16_t millisecond = 0;
  uint16_t microsecond = 0;
  uint16_t nanosecond = 0;
};

// Mirror of upstream's `ParsedDate`. The calendar field is a kind enum
// representing the IANA Calendar identifier; the full Calendar class is
// in calendar.cc (forthcoming).
struct ParsedDate {
  ParsedDateRecord record;
  uint8_t calendar_kind = 0;  // 0 = ISO (default)

  // Mirrors upstream's ParsedDate::from_utf8 / year_month_from_utf8 /
  // month_day_from_utf8. Returns Range or Syntax errors.
  static TemporalResult<ParsedDate> FromUtf8(const uint8_t* data,
                                              size_t length) noexcept;
  static TemporalResult<ParsedDate> YearMonthFromUtf8(const uint8_t* data,
                                                       size_t length) noexcept;
  static TemporalResult<ParsedDate> MonthDayFromUtf8(const uint8_t* data,
                                                      size_t length) noexcept;
};

// Mirror of upstream's `ParsedDateTime`.
struct ParsedDateTime {
  ParsedDate date;
  ParsedTime time;

  static TemporalResult<ParsedDateTime> FromUtf8(const uint8_t* data,
                                                  size_t length) noexcept;
};

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_PARSED_INTERMEDIATES_H_
