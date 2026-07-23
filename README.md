# Socket BTM

[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)
[![Follow @socket.dev on Bluesky](https://img.shields.io/badge/Follow-@socket.dev-1DA1F2?style=social&logo=bluesky)](https://bsky.app/profile/socket.dev)

## Status: descoped

This repo was Socket's build toolchain for prebuilt binaries and ML models. Its
components have moved to their own repos or been discontinued, and no build
lanes remain here.

**Moved to their own repos:**

- Node.js distribution, its build-input builders, and the smol-ai / ML model
  stack — moved to [node-smol](https://github.com/SocketDev/node-smol).
- Terminal UI stack — moved to [stuie](https://github.com/SocketDev/stuie).
- Binary filesystem-compression core — moved to
  [decmpfs](https://github.com/SocketDev/decmpfs).
- Keychain and credential-broker stack — moved to
  [sockeye](https://github.com/SocketDev/sockeye).
- Code signing — moved to [envrypt](https://github.com/SocketDev/envrypt).

**Discontinued:**

- The `@socketbin/*` packages and the binject / binpress / binflate binary
  manipulation suite.
- The `@socketaddon/*` packages and their prebuild lanes.

What remains is fleet scaffolding: shared lint, check, and CI tooling kept
green so history, releases, and published artifacts stay reachable.

## License

MIT
