# keystore-infra

Source-only C / Objective-C++ core for OS-keychain access, compiled inline by
every surface that needs it. No binary release of its own, the same model as
`tui-infra` and `temporal-infra`.

## What it is

A small `extern "C"` interface (`keystore.h`) plus per-platform backends:

- **macOS** (`keystore_macos.mm`): generic-password keychain items stored behind
  a Secure-Enclave-enforced biometric ACL (`kSecAccessControlBiometryCurrentSet`),
  so `SecItemCopyMatching` raises Touch ID and the caller never touches the
  fingerprint.
- **Linux** (`keystore_linux.c`): the freedesktop Secret Service via libsecret
  (broker-only, no biometric; the Secret Service daemon owns keyring unlock).
  Compile-checked against the libsecret headers; it runs under Linux CI, where
  the Secret Service is available.
- **Windows** (`keystore_win.c`): the Credential Manager via the `Cred*` API
  (broker-only; Windows Hello later). Compile-checked against the Windows
  headers (mingw-w64); it runs under Windows CI.

## Who compiles it

| Consumer | Surface |
| --- | --- |
| `proteus-builder` | the proteus daemon (biometric broker with a warm TTL cache) |
| `node-smol-builder` | the `node:smol-keychain` builtin (in-process keychain for the smol binary) |
| a `.node` addon | `@socketaddon/proteus-keychain-*` for regular Node consumers |

Consumers reference the source directly (`../keystore-infra/src/...` from a
sibling Makefile, or via the node-smol `additions/source-patched` sync), exactly
as `proteus-builder` pulls `../bin-infra/src/...`. macOS links `-framework
Security -framework LocalAuthentication -framework Foundation`.

The interface is the single source of truth: the daemon adds the warm cache and
cross-process vending on top, the builtin and the addon expose the raw
read/write/delete in-process.
