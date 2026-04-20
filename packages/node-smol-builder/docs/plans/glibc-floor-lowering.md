# Lowering the Linux glibc floor — staged plan

**Status**: groundwork delivered. No behavior change on current builds.

> **Audience note**: this document is written for an engineer who has **not** worked on node-gyp, Depot.dev, manylinux, or the socket-btm build pipeline before. Every step has exact commands, expected outputs, decision trees, and rollback steps. Skim-read the "Goal" and "Strategy" sections, then follow the phases in order.

---

## Goal

Lower our Linux glibc floor from **2.28** (AlmaLinux 8 / RHEL 8, today's default) to **2.17** (CentOS 7 / Amazon Linux 1 / aarch64 baseline). Once done, our `node` binary will run on older enterprise systems that ship glibc 2.17 without requiring upgrades.

Why 2.17 and not lower? Because **2.17 is the ultimate aarch64 glibc floor**. Going lower on x64 alone has no value — users who want the same binary for arm64 are already stuck at 2.17.

---

## Strategy — `--wrap` + `dlsym` + fallback

Adopted verbatim from Bun's [oven-sh/bun#29461](https://github.com/oven-sh/bun/pull/29461).

For every glibc symbol that arrived after 2.17, we:

1. **Tell the linker to rename references** to the symbol via `-Wl,--wrap=<name>`. Instead of linking against `<name>`, the binary now links against `__wrap_<name>`, which we own.
2. **Define `__wrap_<name>` in `glibc_compat.cc`**:
   - Call `dlsym(RTLD_NEXT, "<name>")` to look up the real glibc implementation at runtime.
   - If it exists (i.e. running on glibc ≥ the introduction version): forward to it. **Behavior identical to unwrapped.**
   - If it doesn't exist (i.e. running on glibc 2.17): run a compatibility fallback that stays within the 2.17 ABI.

On today's build hosts (glibc 2.28) the wrap is inert — dlsym always finds the real impl and we always forward. **You can land the wrap code today and nothing changes.** That's exactly what patch `021-glibc-compat-layer.patch` already does.

---

## Groundwork already delivered

These are done and live in `main`. You do not need to redo them.

### Wraps implemented

**File**: `additions/source-patched/src/socketsecurity/compat/glibc_compat.{h,cc}`
**Patch**: `patches/source-patched/021-glibc-compat-layer.patch`

| Symbol | glibc intro | Fallback |
| --- | --- | --- |
| `__cxa_thread_atexit_impl` | 2.18 | libc++abi-19.1 port |
| `getrandom` | 2.25 | `syscall(SYS_getrandom, ...)` |
| `quick_exit` | 2.24 | drain our own at_quick_exit list, then `_exit()` |
| `at_quick_exit` | 2.24 | process-local LIFO list (32-slot C11 minimum) |

The compat layer compiles to an empty TU on musl (`#ifdef __GLIBC__` guard). Every `-Wl,--wrap` is a no-op on musl (symbols unreferenced in musl ABI).

### c-ares header guard

**Patch**: `patches/source-patched/022-cares-getrandom-glibc-prereq.patch`

Gates `HAVE_GETRANDOM` and `HAVE_SYS_RANDOM_H` in `deps/cares/config/linux/ares_config.h` on `__GLIBC_PREREQ(2, 25)` so that compiling cares on glibc < 2.25 doesn't try to `#include <sys/random.h>` (which doesn't exist there). Known breakage tracked in [nodejs/node#52223](https://github.com/nodejs/node/issues/52223).

### Symbol audit script

**Script**: `packages/node-smol-builder/scripts/audit-glibc-symbols.mts`
**npm**: `pnpm --filter node-smol-builder run glibc:audit`

Runs `objdump -T` on the built binary, parses every `(GLIBC_2.x)` reference, prints a count-per-version table, and exits non-zero if any symbol exceeds a configurable floor (default 2.17). Use this **now** against current glibc 2.28 builds to see what we'd need to wrap if we actually lowered the floor.

### Enforcement test

**Test**: `packages/node-smol-builder/test/integration/glibc-floor.test.mts`

Vitest integration test. Skipped when `GLIBC_FLOOR` env is unset (today). When set to e.g. `2.17`, it runs `objdump -T` and fails the test if any symbol exceeds the floor. **It's dormant on current CI.** Wire it in once we actually lower the floor (Phase 3 below).

### Build-infra plumbing

`build-infra/lib/platform-mappings.mts` exports `getRequestedGlibcFloor()` which returns `undefined` | `"2.17"` | `"2.28"` from the `GLIBC_FLOOR` env var. No callers today — ready to thread through cache keys and Docker image selection when we actually lower.

---

## Remaining work

**Do not start these until the groundwork above has soaked on main for at least one release cycle and no regressions have been reported.**

### Phase 1 — enumerate today's `> 2.17` symbols

**What**: Get the authoritative list of symbols we'd need to handle to actually lower the floor. Right now we wrap 4 symbols based on Bun's observations for a Zig/WebKit binary; our V8/ICU/libuv/openssl/ngtcp2 combo may pull in more.

**Why blocking**: We can't know how much work Phase 2 is without this list.

**How** (exact commands):

```bash
# 1. Build the binary (takes ~30 min on cold cache).
pnpm --filter node-smol-builder build --prod

# 2. Run the audit. Floor=2.17 = print everything > 2.17.
pnpm --filter node-smol-builder run glibc:audit --floor=2.17

# Expected output on glibc 2.28 build today: a table of violations plus
# a list of specific (symbol, version) pairs. Example:
#
#   GLIBC version  |  Symbol count
#   ---------------|--------------
#     2.2.5        |    137
#     2.17         |     42
#     2.18         |      5   <-- new: __cxa_thread_atexit_impl et al
#     2.22         |      1
#     2.25         |      3   <-- getrandom, getentropy
#     2.28         |      9   <-- fcntl64 et al
#
#   9 symbol(s) exceed floor GLIBC_2.17:
#     GLIBC_2.18     __cxa_thread_atexit_impl
#     ...
```

**Decision tree**:

- **Zero violations**: we're already at 2.17. Skip to Phase 3.
- **Violations are all already handled by 021 + 022**: skip to Phase 2.
- **Violations include new symbols not in 021**: extend `glibc_compat.cc` with one wrap per new symbol, following the existing pattern (dlsym + fallback). Rebuild, re-audit. Loop until zero.

**Rollback**: none needed — this phase is read-only.

**Known tricky cases**:

- **`fcntl64@2.28`**: this is NOT a code-level issue. `fcntl()` calls are emitted by glibc 2.28 headers as `fcntl64@GLIBC_2.28`. **Solved by building on a glibc 2.17 host**, not by wrapping. No source change needed.
- **`pthread_setname_np@2.12`**: introduced pre-2.17, safe.
- **`copy_file_range`, `statx`, `memfd_create`, `mkostemp`, `getentropy`**: libuv calls these via `syscall()` or `dlsym()`, not as linked symbols. Safe.
- **`timespec_get`, `thrd_create`, `renameat2`**: not referenced by the Node tree. Safe.

---

### Phase 2 — build-image migration

**What**: Swap the CI Docker base from AlmaLinux 8 (glibc 2.28) to a glibc 2.17 image.

**Why blocking**: Phase 1's wraps are inert until the build environment itself uses the lower floor. Without swapping the image, `objdump` will keep finding `> 2.17` symbols because the compiler's glibc headers still reference them.

**Candidate bases (pick one)**:

1. **`quay.io/pypa/manylinux2014_x86_64`** — CentOS 7 vault + GCC 10 (from pypa). Well-maintained, supports CentOS 7 via vault repos. Ships GCC 10, which is too old for our C++20 — we'd need to layer SCL `devtoolset-14`. EOL 2027-05-04.
2. **`almalinux:7`** + SCL `devtoolset-14` — simpler base, same glibc 2.17. Red Hat SCL ships via Software Collections, still supported.

**Recommended: option 2** (`almalinux:7` + devtoolset-14). Simpler bootstrap.

**How** (abbreviated — exact Dockerfile is Phase 2 work):

```dockerfile
# packages/node-smol-builder/docker/Dockerfile.glibc-2.17
FROM almalinux:7
RUN yum install -y centos-release-scl
RUN yum install -y devtoolset-14
# Source the toolset and proceed with the same build steps as Dockerfile.glibc.
ENV PATH=/opt/rh/devtoolset-14/root/usr/bin:$PATH
...
```

**Verify before committing**:

```bash
# 1. Does the SCL toolset install cleanly on AlmaLinux 7?
docker run --rm almalinux:7 bash -c 'yum install -y centos-release-scl && yum install -y devtoolset-14 && /opt/rh/devtoolset-14/root/usr/bin/gcc --version'
# Expected: "gcc (GCC) 14.x.x"

# 2. Is glibc actually 2.17?
docker run --rm almalinux:7 ldd --version | head -1
# Expected: "ldd (GNU libc) 2.17"

# 3. Does node build compile under C++20 with this GCC?
# The build script will tell us — just run it in a container.
```

**Decision tree**:

- SCL `devtoolset-14` not available for AlmaLinux 7: fall back to building GCC 14 from source in the image (adds ~45 min one-time, cached forever after).
- AlmaLinux 7 vault repos unreachable: switch to `quay.io/pypa/manylinux2014_x86_64`.

**Rollback**: revert the Dockerfile changes and the `docker/Dockerfile.glibc-2.17` file. Cache-versions bump reverts any in-flight cache.

---

### Phase 3 — CI matrix

**What**: Add a `glibc_floor` dimension to the build matrix so both 2.17 and 2.28 binaries are produced during the rollout, with 2.17 becoming the default once stable.

**How**:

1. Edit `.github/workflows/node-smol.yml`. In the `matrix` block, add:

   ```yaml
   glibc_floor: ['2.17', '2.28']
   ```

2. Thread `matrix.glibc_floor` into the Dockerfile selection:

   ```yaml
   file: packages/node-smol-builder/docker/Dockerfile.${{ matrix.libc || 'glibc' }}${{ matrix.glibc_floor == '2.17' && '-2.17' || '' }}
   ```

3. Thread into the cache key so 2.17 and 2.28 caches don't collide:

   ```yaml
   key: node-checkpoints-...-${{ matrix.glibc_floor }}-${{ steps.smol-cache-key.outputs.final_hash }}
   ```

4. Set job-level `env.GLIBC_FLOOR: ${{ matrix.glibc_floor }}` so the enforcement test (Phase 4) runs and succeeds for both variants.

**Rollback**: drop the matrix dimension, revert the Dockerfile suffix logic, bump cache version in `.github/cache-versions.json` so both variants invalidate cleanly.

---

### Phase 4 — enforcement test activation

**What**: Turn on the `glibc-floor.test.mts` that already exists (dormant today).

**How**:

1. Set `GLIBC_FLOOR=${{ matrix.glibc_floor }}` in the workflow env.
2. The test's `describe.skipIf` flips from `skip` to `run`.
3. First run will either pass (we're genuinely at the floor) or produce the violation list for you to feed back into Phase 1's glibc_compat.cc extension.

**Rollback**: unset `GLIBC_FLOOR` in CI; test goes back to skipped.

---

### Phase 5 — runtime smoke test on CentOS 7

**What**: Run the actually-built 2.17 binary inside a CentOS 7 container and execute our smoke-test suite. This catches runtime issues (e.g. `thread_local` destructor behavior) that the link-time check cannot.

**How**:

```yaml
- name: Smoke-test on CentOS 7 (glibc 2.17 runtime)
  if: matrix.glibc_floor == '2.17' && matrix.os == 'linux'
  run: |
    docker run --rm \
      -v $PWD/packages/node-smol-builder/build/prod/linux-x64/out/Final:/binary \
      -v $PWD/packages/node-smol-builder/test/smoke:/smoke \
      almalinux:7 \
      /binary/node /smoke/index.mjs
```

**Rollback**: remove the step.

---

## Known limitations of the compat layer

Inherited from the libc++abi 19.1 port of `__cxa_thread_atexit_impl`:

- **`dso_symbol` is ignored.** Glibc's impl uses it for DSO refcount handling; on 2.17 hosts where the real impl is missing, `dlclose()` of FFI addons with thread_local state may be unsafe. In practice, we almost never `dlclose()` FFI modules during process lifetime, so this limitation is latent.
- **Main-thread destructors run at static-destruction time, not thread-exit time.** Same libc++abi limitation; acceptable tradeoff on 2.17 hosts.

Both limitations only apply when the fallback path is taken. On glibc 2.18+ the dlsym forward is used, semantics are unchanged.

Inherited from our `getrandom` fallback:

- **vDSO fast path is lost on pre-glibc-2.41 systems** (where glibc itself doesn't yet use vDSO). The `syscall()` path is ~2× slower than glibc's SYS_getrandom wrapper. Crypto and c-ares seed just fine, just a bit slower. Only matters under extreme entropy-hungry workloads.

Inherited from our `quick_exit` fallback:

- **`std::quick_exit` on 2.17 hosts is `_exit`** after draining our own at_quick_exit list. Different from glibc's 2.24 impl in one edge case: glibc also runs the C++ `std::exception_ptr` cleanup; ours does not. No known in-tree caller depends on this behavior.

---

## References

- [Bun PR 29461](https://github.com/oven-sh/bun/pull/29461) — the recipe; sourced all three Bun wraps from this.
- [libc++abi 19.1.0 `cxa_thread_atexit.cpp`](https://github.com/llvm/llvm-project/blob/llvmorg-19.1.0/libcxxabi/src/cxa_thread_atexit.cpp) — source of our `__cxa_thread_atexit_impl` fallback, Apache-2.0 WITH LLVM-exception.
- [pypa/manylinux](https://github.com/pypa/manylinux) — candidate base image, EOL 2027-05-04.
- [nodejs/node#52223](https://github.com/nodejs/node/issues/52223) — c-ares `<sys/random.h>` breakage on old glibc (addressed by patch 022).
- [glibc#20198](https://sourceware.org/bugzilla/show_bug.cgi?id=20198) — why `quick_exit@2.24` differs semantically from `@2.10`.
- [C11 §7.22.4.3](https://port70.net/~nsz/c/c11/n1570.html#7.22.4.3) — `at_quick_exit` spec, 32-handler minimum.
