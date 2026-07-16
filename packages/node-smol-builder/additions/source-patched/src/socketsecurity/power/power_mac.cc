// macOS power-state detection via IOKit.
//
// IOPSCopyPowerSourcesInfo returns a CFTypeRef snapshot.
// IOPSCopyPowerSourcesList enumerates the sources within it.
// IOPSGetPowerSourceDescription returns a CFDictionaryRef per source.
//
// We're on AC if any internal-type, present source reports
// kIOPSACPowerValue. Multiple sources are uncommon (laptop + UPS,
// for example) but possible — `any-source-on-AC` matches Electron's
// behavior.
//
// Filtering rules (ported from chromium services/device/battery/
// battery_status_manager_mac.cc):
//   - kIOPSTransportTypeKey == kIOPSInternalType  (skip external UPS,
//     USB battery packs that masquerade as a power source)
//   - kIOPSIsPresentKey == true                   (skip empty slots)
//
// Desktops with no battery have no power sources at all — return
// true (treat as AC) so headless / build-server callers don't get
// false-positive battery-mode behavior.

#include "socketsecurity/power/power.h"

#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/ps/IOPSKeys.h>
#include <IOKit/ps/IOPowerSources.h>

namespace node {
namespace socketsecurity {
namespace power {

namespace {

// Compare two CFStrings safely (handles nullptr inputs).
bool CFStringsAreEqual(CFStringRef a, CFStringRef b) {
  if (a == nullptr || b == nullptr) {
    return false;
  }
  return CFStringCompare(a, b, 0) == kCFCompareEqualTo;
}

}  // namespace

bool IsOnAcPowerImpl() {
  CFTypeRef snapshot = IOPSCopyPowerSourcesInfo();
  if (snapshot == nullptr) {
    return true;
  }

  CFArrayRef sources = IOPSCopyPowerSourcesList(snapshot);
  if (sources == nullptr) {
    CFRelease(snapshot);
    return true;
  }

  CFIndex count = CFArrayGetCount(sources);
  if (count == 0) {
    // No sources — desktop with no battery.
    CFRelease(sources);
    CFRelease(snapshot);
    return true;
  }

  bool on_ac = false;
  for (CFIndex i = 0; i < count; i++) {
    CFTypeRef src = CFArrayGetValueAtIndex(sources, i);
    CFDictionaryRef desc = IOPSGetPowerSourceDescription(snapshot, src);
    if (desc == nullptr) {
      continue;
    }

    CFStringRef transport = static_cast<CFStringRef>(
        CFDictionaryGetValue(desc, CFSTR(kIOPSTransportTypeKey)));
    if (!CFStringsAreEqual(transport, CFSTR(kIOPSInternalType))) {
      continue;
    }

    CFBooleanRef present = static_cast<CFBooleanRef>(
        CFDictionaryGetValue(desc, CFSTR(kIOPSIsPresentKey)));
    if (present == nullptr || !CFBooleanGetValue(present)) {
      continue;
    }

    CFStringRef state = static_cast<CFStringRef>(
        CFDictionaryGetValue(desc, CFSTR(kIOPSPowerSourceStateKey)));
    if (CFStringsAreEqual(state, CFSTR(kIOPSACPowerValue))) {
      on_ac = true;
      break;
    }
  }

  CFRelease(sources);
  CFRelease(snapshot);
  return on_ac;
}

}  // namespace power
}  // namespace socketsecurity
}  // namespace node
