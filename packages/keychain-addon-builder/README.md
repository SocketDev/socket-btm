# keychain-addon-builder

Builds **`keychain.node`**, the N-API addon that exposes the shared
`keystore-infra` core to regular (non-smol) Node consumers. socket-addon
republishes it as `@socketaddon/keychain-*` (per-platform packages plus a shim),
the same lane opentui uses.

## What it is

A thin N-API shim (`keychain_napi.mm`) over `keystore-infra`'s `keystore_get`,
`keystore_put`, and `keystore_delete`, compiled together into a loadable
`.node`:

```js
const keychain = require('@socketaddon/keychain')
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

## Status

macOS is implemented and verified (build, `require`, and a get/del round-trip on
the not-found path, which raises no biometric prompt). The Linux and Windows
`.node` (the N-API shim compiled as C against `keystore-infra`'s libsecret and
Credential Manager backends) is a later phase, tracked with `keystore-infra`.
