'use strict'

// node:smol-power — minimal sync API for AC vs battery detection.
//
// Mirrors Electron's powerMonitor.isOnBatteryPower() / isOnAcPower()
// surface. No level / chargingTime / dischargingTime: those W3C
// BatteryManager attributes are deliberately omitted — Electron's
// production experience confirmed they're not reliable enough across
// hardware to be useful.
//
// Backed by a native binding (smol_power) implemented in
// src/socketsecurity/power/. macOS uses IOKit, Windows uses
// GetSystemPowerStatus, Linux reads /sys/class/power_supply/*/online.
// No shellouts, no D-Bus, no daemons.

const { ObjectFreeze } = primordials

const { isOnAcPower, isOnBatteryPower } = internalBinding('smol_power')

module.exports = ObjectFreeze({
  __proto__: null,
  isOnAcPower,
  isOnBatteryPower,
})
