// 1:1 port of upstream `src/utils.rs`.

#include "socketsecurity/temporal/utils.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Fliegel-Van Flandern: standard formula. JDN of 1970-01-01 = 2440588.
int64_t EpochDaysFromGregorianDate(int32_t year, uint8_t month,
                                   uint8_t day) noexcept {
  int32_t a = (14 - month) / 12;
  int32_t y = year + 4800 - a;
  int32_t m = month + 12 * a - 3;
  int64_t jdn = static_cast<int64_t>(day) + (153 * m + 2) / 5 +
                365LL * y + y / 4 - y / 100 + y / 400 - 32045;
  return jdn - 2440588;
}

// Inverse of the above. Standard reverse-Julian conversion.
void YmdFromEpochDays(int64_t epoch_days, int32_t* year, uint8_t* month,
                      uint8_t* day) noexcept {
  int64_t jdn = epoch_days + 2440588;
  int64_t a = jdn + 32044;
  int64_t b = (4 * a + 3) / 146097;
  int64_t c = a - (146097 * b) / 4;
  int64_t d = (4 * c + 3) / 1461;
  int64_t e = c - (1461 * d) / 4;
  int64_t m_zero = (5 * e + 2) / 153;
  *day = static_cast<uint8_t>(e - (153 * m_zero + 2) / 5 + 1);
  *month = static_cast<uint8_t>(m_zero + 3 - 12 * (m_zero / 10));
  *year = static_cast<int32_t>(100 * b + d - 4800 + m_zero / 10);
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
