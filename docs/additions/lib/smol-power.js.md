# smol-power.js -- Public API for power-state detection (node:smol-power)

## What This File Does

This is the entry point for `require('node:smol-power')`. It exposes
two synchronous functions backed by the C++ binding (`smol_power`)
that report whether the host is on AC power vs battery.

## How It Fits Together

This is a thin wrapper around the native binding -- no JS-side state,
no caching, no events. Each call goes straight to the per-platform
syscall:

```
require('node:smol-power') -> this file (smol-power.js)
  -> internalBinding('smol_power') (C++ native binding)
    -> macOS:   IOKit IOPSCopyPowerSourcesInfo
    -> Linux:   /sys/class/power_supply/<entry>/online direct reads
    -> Windows: kernel32 GetSystemPowerStatus
```

## Public API

```ts
import { isOnAcPower, isOnBatteryPower } from 'node:smol-power'

const ac = isOnAcPower() // true on AC, false on battery
const bat = isOnBatteryPower() // inverse of isOnAcPower()
```

## Design Choices

The API surface mirrors **Electron's `powerMonitor.isOnBatteryPower()`**
form rather than the W3C `BatteryManager` spec. Electron's production
experience confirmed that `level` / `chargingTime` / `dischargingTime`
aren't reliable enough across hardware to be useful in practice; the
two-method boolean form is what real apps actually consume.

## Conservative Defaults

Detection failure or platforms without a power tree (containers,
headless servers, desktops without batteries) return `true` from
`isOnAcPower()`. Build servers and CI environments shouldn't get
false-positive battery-mode behavior just because the kernel doesn't
report power state.

## Where the Real Work Happens

The native implementation lives in
`additions/source-patched/src/socketsecurity/power/`:

- `power_binding.cc` -- platform-agnostic V8 glue
- `power_mac.cc` -- macOS IOKit (`IOPSCopyPowerSourcesInfo`,
  filtered to `kIOPSInternalType` + `kIOPSIsPresentKey`)
- `power_linux.cc` -- POSIX syscalls on `/sys/class/power_supply`
  (no D-Bus, no UPower, no shellout)
- `power_win.cc` -- kernel32 `GetSystemPowerStatus`
- `power_stub.cc` -- fallback for unknown platforms

## Use Case

Long-running build/test scripts size their kill-timeout adaptively
based on power state. macOS especially throttles CPU hard on battery,
and a static timeout tuned for AC will kill an otherwise-healthy run
when the laptop's unplugged.
