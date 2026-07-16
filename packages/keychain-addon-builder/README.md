# keychain-addon-builder

Builds **`keychain.node`**, the N-API addon that exposes the shared
`keystore-infra` core to regular (non-smol) Node consumers. The addon is shipped
as per-platform assets on a GitHub Release so bootstrap code can download one
exact, checksum-pinned file without running a native build on the developer's
machine.

## What it is

A thin N-API shim (`keychain_napi.mm`) over `keystore-infra`'s `keystore_get`,
`keystore_put`, and `keystore_delete`, compiled together into a loadable
`.node`:

```js
const keychain = require('/path/to/keychain.node')
keychain.get('socketsecurity', 'ANTHROPIC_API_KEY') // string | undefined (Touch ID on macOS)
keychain.set('socketsecurity', 'ANTHROPIC_API_KEY', 'sk-…')
keychain.del('socketsecurity', 'ANTHROPIC_API_KEY')
```

It is one of three surfaces over the same core: the proteus **daemon** (broker
plus warm cache), the **`node:smol-keychain` builtin** (in-process, for the smol
binary), and this **`.node` addon** (in-process, for stock Node).

## Build

```bash
pnpm --filter keychain-addon-builder build
```

Direct `clang++` link, no node-gyp and no new deps, mirroring `napi-go-infra`:
`-shared -undefined dynamic_lookup -Wl,-S`, node's bundled N-API headers on the
include path, plus `-framework Foundation Security LocalAuthentication`. Output
lands at `build/<mode>/<platform-arch>/out/Final/keychain.node`.

## Platform behavior

- macOS uses Keychain generic-password items. New values are protected with a
  biometric ACL, so a later read can show a Touch ID prompt.
- Linux uses the Secret Service through `libsecret`. The machine needs a Secret
  Service provider such as GNOME Keyring or KWallet.
- Windows uses Credential Manager.

The release matrix covers macOS arm64/x64, Linux arm64/x64, and Windows x64.
Windows arm64 uses the x64 addon under emulation until GitHub provides the
matching native runner/toolchain lane.

See [releasing.md](releasing.md) for the dry-run and gated release flow.
