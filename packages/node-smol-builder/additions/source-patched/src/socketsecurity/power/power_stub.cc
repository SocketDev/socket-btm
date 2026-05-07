// Fallback power-state stub for unknown platforms.
//
// Compiled in for any platform that doesn't match darwin / linux /
// win32. Conservative default: assume AC (matches the macOS / Linux
// / Windows fallbacks when their detection APIs fail).

#include "socketsecurity/power/power.h"

namespace node {
namespace socketsecurity {
namespace power {

bool IsOnAcPowerImpl() {
  return true;
}

}  // namespace power
}  // namespace socketsecurity
}  // namespace node
