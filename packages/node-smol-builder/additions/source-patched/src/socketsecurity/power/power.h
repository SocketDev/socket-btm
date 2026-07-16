// Platform-agnostic power-state interface for node:smol-power.
//
// One function. The implementation lives in a per-platform .cc file
// (power_mac.cc / power_win.cc / power_linux.cc) so
// the V8 binding glue in power_binding.cc stays free of platform
// `#ifdef`s and platform headers.
//
// Returns true if the host is on AC power, false on battery, with a
// conservative default of true on detection failure / unsupported
// platforms (build servers and headless environments shouldn't get
// false-positive battery-mode behavior).

#ifndef SRC_SOCKETSECURITY_POWER_POWER_H_
#define SRC_SOCKETSECURITY_POWER_POWER_H_

namespace node {
namespace socketsecurity {
namespace power {

bool IsOnAcPowerImpl();

}  // namespace power
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_POWER_POWER_H_
