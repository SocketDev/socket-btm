/**
 * node:smol-power — synchronous AC-vs-battery detection.
 *
 * Mirrors Electron's `powerMonitor.isOnBatteryPower()` /
 * `isOnAcPower()` surface. No level / chargingTime / dischargingTime:
 * the W3C BatteryManager attributes are deliberately omitted because
 * they're not reliable enough across hardware to be useful (Electron's
 * production experience landed on the same minimal surface).
 *
 * Implementation:
 * - **macOS**:   IOKit (`IOPSCopyPowerSourcesInfo`)
 * - **Windows**: `GetSystemPowerStatus` from kernel32
 * - **Linux**:   `/sys/class/power_supply/*\/online` via direct
 *                POSIX syscalls (no D-Bus, no UPower, no shellout)
 *
 * Conservative defaults: detection failure or platforms without a
 * power tree (containers, headless servers, desktops) report AC. So
 * callers using this for timeout sizing don't artificially extend
 * timeouts on machines that aren't power-managed.
 *
 * @example
 * ```ts
 * import { isOnAcPower } from 'node:smol-power'
 *
 * const timeoutMs = isOnAcPower() ? 480_000 : 900_000
 * ```
 */
declare module 'node:smol-power' {
  /**
   * True if the host is running on AC power. Conservative on
   * detection failure — returns true.
   */
  export function isOnAcPower(): boolean

  /**
   * True if the host is running on battery. Inverse of
   * `isOnAcPower()`.
   */
  export function isOnBatteryPower(): boolean
}
