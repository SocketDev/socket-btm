# proteus-builder

Builds **proteus**, the fleet credential broker: a small native daemon that
guards provider credentials in the OS keychain and vends short-lived tokens to
socket-lib over a local Unix socket. Named for Proteus, who yields secret
knowledge only to one who holds his grip through his shape-shifting (the
biometric gate, mythologized).

Secrets stay in the OS keychain, on the Secure Enclave on macOS, gated by Touch
ID. They never live in env vars, `.env`, or dotfiles. They materialize only
into a spawned child's env for the lifetime of that one spawn, or flow through
the socket in memory after a successful biometric prompt.

## Platform matrix

| Platform                               | Build       | Biometric                 | Keystore it fronts         |
| -------------------------------------- | ----------- | ------------------------- | -------------------------- |
| darwin-arm64 / darwin-x64              | full        | Touch ID + Secure Enclave | macOS Keychain             |
| linux-x64 / linux-arm64 (glibc + musl) | broker-only | none                      | Secret Service (libsecret) |
| win32-x64 / win32-arm64                | broker-only | none (Hello later)        | Credential Manager         |

Only the macOS targets get the Touch-ID / Secure-Enclave path, since that
capability is Apple-only. The other six build the same daemon and front their
native keystore without a biometric prompt.

## Daemon lifecycle

- **Socket:** `getRuntimeSocketPath('proteus')` from `@socketsecurity/lib`
  resolves to `$XDG_RUNTIME_DIR/proteus.sock`, then `$TMPDIR/proteus-<uid>.sock`,
  then a `\\.\pipe\proteus-sock` named pipe on Windows. The daemon and every
  client compute the identical path.
- **Single instance:** the `<socket>.pid` file is created `O_CREAT|O_EXCL`, so
  the exclusive create is itself the lock. A live pidfile means another daemon
  owns the socket, so the new process refuses to start. A stale pidfile (no live
  process) is unlinked and the socket re-bound.
- **Owner-only:** the socket is mode `0600`, and every connection's peer uid is
  checked (`SO_PEERCRED` / `LOCAL_PEERCRED`) so non-owner peers are rejected.
- **Wire format:** NDJSON request/response, following the acorn-daemon
  convention.
- **TTL cache:** after one successful Touch ID, the unlocked value is held in
  memory for N seconds so repeated spawns don't re-prompt.
- **Stop:** SIGTERM, wait, SIGKILL, then unlink both the pidfile and the socket.

## Build

```bash
pnpm --filter proteus-builder build
```

This selects `Makefile.<os>` for the host platform and emits the `proteus`
binary under `build/<mode>/<platform-arch>/out/Final/`. macOS links `-framework
Security -framework LocalAuthentication`.

## Wire protocol

One NDJSON request line in, one JSON response line out. Requests are flat
objects:

```
{"op":"get","service":"anthropic","account":"ANTHROPIC_API_KEY"}
{"op":"put","service":"anthropic","account":"ANTHROPIC_API_KEY","value":"sk-…"}
{"op":"delete","service":"anthropic","account":"ANTHROPIC_API_KEY"}
ping
```

A `get` consults the TTL cache first, then the keystore (which raises the
biometric prompt on macOS). Responses are `{"ok":true,…}` or `{"ok":false,
"error":"…"}` where the error is one of `not-found`, `denied`,
`keystore-unavailable`, `keystore-io`, `peer-uid-mismatch`, `unknown-op`.

## Status

Landed: package wiring, the daemon lifecycle (socket server, single-instance
pidfile, peer-uid gate, TTL cache, NDJSON dispatch), and the **macOS keychain
backend** with a Secure-Enclave-enforced biometric ACL
(`kSecAccessControlBiometryCurrentSet`). Verified on darwin-arm64: builds clean,
and the lifecycle test covers ping, not-found, delete, and unknown-op. The
write + biometric-read round-trip needs an interactive Touch ID prompt, so it is
verified manually rather than in CI.

The daemon is now **cross-platform**: POSIX uses an AF_UNIX socket; Windows uses
a named pipe (`\\.\pipe\proteus-sock`) with peer identity via
`GetNamedPipeClientProcessId` + token-SID compare, `CREATE_NEW` pidfile lock, and
an overlapped-connect idle timeout. macOS is run-verified (6/6 lifecycle tests);
the Windows path compiles + links clean via mingw (`Makefile.win`); CI builds the
real per-platform artifact.

Pending: the OAuth/PKCE runner and the `proteus-<platform>` GitHub Release wiring.
The keystore backends all exist (macOS run-verified, Linux + Windows
compile-verified), as does the socket-lib broker tier.

Design of record: `socket-lib/.claude/plans/proteus-credential-broker.md`.
