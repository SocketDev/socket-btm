# keychain-cli-builder

Builds **`socket-keychain`**, a small standalone C++ command-line program for
the operating system's credential store. It is the fleet bootstrap surface:
wheelhouse installs one checksum-pinned binary from a GitHub Release, then local
tools can read credentials without a plaintext `.env` file.

The separate `keychain-addon-builder` still builds `keychain.node`. That addon
is intended for the future `@node-smol/keychain` package and is not required by
this executable.

## Commands

```text
socket-keychain get <service> <account>
socket-keychain set <service> <account>
socket-keychain delete <service> <account>
```

`get` writes only the stored value to stdout. `set` reads the value from stdin,
so it never places a secret in the process argument list. Use `printf`, not
`echo`, because `echo` adds a newline to the stored value:

```bash
printf '%s' "$TOKEN" | socket-keychain set socketsecurity ANTHROPIC_API_KEY
socket-keychain get socketsecurity ANTHROPIC_API_KEY
socket-keychain delete socketsecurity ANTHROPIC_API_KEY
```

Exit code `3` means the requested entry does not exist. Other failures use a
different non-zero code and write a short explanation to stderr; secret values
are never included in error messages.

## Why this shape

This executable is the local secret bridge for AI tools, repository hooks,
Agent-CI, and other developer-box automation. Those tools need individual
credentials at runtime, but they should not require plaintext `.env` files or
place raw values in the command line.

The design follows a few rules:

- `set` receives the secret on stdin. It never places secret bytes in argv or
  shell history.
- A credential has a stable `service + account` identity. Callers ask for one
  named value instead of loading a file full of unrelated secrets.
- Setup and lookup are separate. A human provisions a credential once; hooks
  and launchers use the read-only `get` path later.
- Updates and deletes are idempotent. Re-running setup or cleanup produces the
  same final state.
- macOS protects new entries with Touch ID and device-only storage. A caller
  may attempt a read, but the value is not returned until the user approves the
  native prompt.
- Linux delegates unlocking to Secret Service. Windows currently uses a local
  generic Credential Manager entry; Windows Hello gating is follow-up work.
- The Agent-CI launcher owns the read deadline. If nobody can answer a native
  prompt, it terminates this child instead of waiting forever.
- A launcher passes the retrieved value only to its intended child process and
  drops its own copy afterward. The binary never prints a secret anywhere
  except stdout for a successful, explicitly requested `get`.

The higher-level wheelhouse setup command provides the simple “native up”
experience. This low-level binary stays generic so other local tools can use the
same audited credential primitive.

## Build

```bash
pnpm --filter keychain-cli-builder build
```

The output is
`build/<mode>/<platform-arch>/out/Final/socket-keychain[.exe]`. macOS uses
Keychain, Linux uses Secret Service through libsecret, and Windows uses
Credential Manager.

See [the release guide](docs/releasing.md) for the dry-run and publish gates,
asset names, and supported platform matrix.
