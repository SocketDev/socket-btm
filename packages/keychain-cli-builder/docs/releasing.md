# Releasing `socket-keychain`

The release workflow builds one executable for each supported platform and CPU.
It starts in dry-run mode, so testing the workflow cannot publish anything.

## Before releasing

1. Choose a plain `X.Y.Z` version. The workflow does not choose or bump a
   version for you.
2. Run the **Keychain CLI** workflow with **dry-run** enabled.
3. Confirm all five builds pass their help, version, missing-read, binary-header,
   and checksum checks.
4. Run it again with the same version and **dry-run** disabled. The protected
   `release` environment is the final human approval gate.

The workflow creates a draft, uploads every asset, and only then publishes the
release. This prevents users from seeing a release with half of its files
missing.

## Published files

Each release contains:

- `socket-keychain-<version>-darwin-arm64`
- `socket-keychain-<version>-darwin-x64`
- `socket-keychain-<version>-linux-arm64`
- `socket-keychain-<version>-linux-x64`
- `socket-keychain-<version>-win32-x64.exe`
- `checksums.txt`

Wheelhouse records the chosen version and each SHA-256 value. Its installer
downloads only the exact asset for the current machine and rejects a checksum
mismatch before making the executable available to hooks or Agent-CI.

Windows arm64 is not published yet. Windows runs the x64 binary under its normal
emulation layer until a native arm64 toolchain is added and verified.
