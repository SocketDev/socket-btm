// Windows power-state detection via GetSystemPowerStatus.
//
// SYSTEM_POWER_STATUS.ACLineStatus byte:
//   0   — offline (battery)
//   1   — online  (AC)
//   255 — unknown (typical for desktops with no battery; treat as AC)
//
// API failure also defaults to AC (conservative — same fallback as
// macOS / Linux).

#include "socketsecurity/power/power.h"

// Avoid the gigantic windows.h surface; only need the power-status API.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

namespace node {
namespace socketsecurity {
namespace power {

bool IsOnAcPowerImpl() {
  SYSTEM_POWER_STATUS status;
  if (!GetSystemPowerStatus(&status)) {
    return true;
  }
  if (status.ACLineStatus == 0) {
    return false;
  }
  // 1 = online, 255 = unknown — both treated as AC.
  return true;
}

}  // namespace power
}  // namespace socketsecurity
}  // namespace node
