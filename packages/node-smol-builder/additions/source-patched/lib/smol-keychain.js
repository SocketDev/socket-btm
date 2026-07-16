'use strict'

// node:smol-keychain — in-process OS keychain access backed by the shared
// keystore-infra core (the same get/put/delete the proteus daemon and the
// @socketaddon/keychain `.node` addon use, so all three surfaces share one
// implementation). On macOS a read raises Touch ID inside the native binding
// (Secure-Enclave ACL); linux/win32 are broker-only (libsecret / Credential
// Manager).
//
// Surface:
//
//   get(service, account) -> string | undefined
//     The secret, or undefined when absent. Throws on denial / I/O error
//     (err.message is 'denied' | 'keystore-unavailable' | 'keystore-io').
//
//   set(service, account, value) -> undefined
//     Stores behind the OS keystore (biometric ACL on macOS).
//
//   del(service, account) -> undefined
//     Idempotent (deleting an absent item is success).

const { ObjectFreeze } = primordials

const { get: nativeGet, set, del } = internalBinding('smol_keychain')

// The native binding returns null for an absent item; normalize to undefined to
// match the fleet's "undefined over null" convention.
function get(service, account) {
  const value = nativeGet(service, account)
  return value === null ? undefined : value
}

module.exports = ObjectFreeze({
  __proto__: null,
  del,
  get,
  set,
})
