# update-cacache — Update the C/C++ cacache implementation

Update `socket_cacache.h` to match the `@socketsecurity/lib` cacache spec.
Run when the cacache format changes or cross-platform behavior needs updating.

## What This Updates

| File | Location |
|------|----------|
| `socket_cacache.h` | `packages/build-infra/src/socketsecurity/build-infra/socket_cacache.h` |

## Process

1. **Read the reference spec** from `@socketsecurity/lib`:
   - Path resolution: `../socket-sdk-js/node_modules/@socketsecurity/lib/dist/paths/socket.js`
   - Cacache wrapper: `../socket-sdk-js/node_modules/@socketsecurity/lib/dist/cacache.js`
   - Also check ultrathink implementations for consistency:
     - Rust: `../ultrathink/packages/acorn/lang/rust/src/socket_cacache.rs`
     - Go: `../ultrathink/packages/acorn/lang/go/pkg/acorn/socket_cacache.go`

2. **Update `socket_cacache.h`** to match:
   - Path resolution: env var priority (SOCKET_CACACHE_DIR > SOCKET_HOME > HOME/USERPROFILE > tmpdir)
   - Index: `index-v5/{sha256(key)[0:2]}/{sha256(key)[2:4]}/{sha256(key)[4:]}`
   - Lines: `{sha1(json)}\t{json}\n`
   - Content: `content-v2/sha512/{sha512_hex[0:2]}/{sha512_hex[2:4]}/{sha512_hex[4:]}`
   - Integrity: `sha512-{base64_with_padding(sha512(data))}`
   - Deletion: append `"integrity":null` (soft delete, not file delete)
   - Metadata: always present as `{}` (never null, never omitted)

3. **Cross-platform validation**:
   - macOS: HOME → getenv("HOME"), crypto via CommonCrypto
   - Linux: HOME → getenv("HOME"), crypto via OpenSSL
   - Windows: USERPROFILE → getenv("USERPROFILE"), crypto via CryptoAPI
   - Fallback: TEMP/TMP (Windows) or /tmp (Unix)

4. **Compile test**:
   ```bash
   # macOS
   cc -Wall -Wextra -I. test.c -o test -framework Security

   # Linux
   cc -Wall -Wextra -I. test.c -o test -lssl -lcrypto
   ```

5. **Cross-language verification**:
   ```bash
   # C writes, Node.js reads
   ./test_write
   node -e "require('cacache').get('~/.socket/_cacache', 'key').then(r => console.log(r.data))"
   ```

6. **Run Codex sanity check** — ask Codex to validate against spec.

7. **Commit** with: `fix(build-infra): update socket_cacache.h to match @socketsecurity/lib vX.Y.Z`

## Key Constraints

- Header-only C (static functions) — no .c file needed
- `extern "C"` wrappers for C++ inclusion
- No external deps beyond platform crypto
- Self-contained file I/O helpers (no file_utils.h dependency)
- Internal functions prefixed `scache_` to avoid namespace collisions
- Must produce entries readable by Node.js `cacache@20`

## Reference Docs

- Shared cache guide: `../ultrathink/packages/build-infra/docs/shared-cache.md`
- Platform cache paths: `../ultrathink/packages/build-infra/lib/ci-cleanup-paths.mts`
