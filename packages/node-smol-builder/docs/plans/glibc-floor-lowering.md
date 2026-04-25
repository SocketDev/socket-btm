# Lowering the Linux glibc floor — staged plan

**Status**: groundwork delivered. No behavior change on current builds.

> **Audience note**: this document is written for an engineer who has **not** worked on node-gyp, Depot.dev, manylinux, or the socket-btm build pipeline before. Every step has exact commands, expected outputs, decision trees, and rollback steps. Skim-read the "Why" / "Goal" / "Strategy" sections, then follow the phases in order.

---

## Why — who this unblocks

Our `node-smol` SEA binaries ship to users as a single self-contained executable. Today we link against **glibc 2.28** (AlmaLinux 8 / RHEL 8), which means the binary refuses to run on older enterprise Linux hosts — the user sees a hard `GLIBC_2.28 not found` loader error before their JS ever executes.

Lowering to **glibc 2.17** directly unblocks these deployment targets:

| Distribution | glibc | Status (April 2026) | Today | After 2.17 floor |
|---|---|---|---|---|
| **RHEL 7** / **CentOS 7** | 2.17 | CentOS 7 EOL 2024-06-30; RHEL 7 Extended Lifecycle through 2028-06-30 | ✗ fails to load | ✓ works |
| **Amazon Linux 1** (AL1) | 2.17 | EOL 2023-12-31; AMIs still launchable | ✗ fails to load | ✓ works |
| **Amazon Linux 2** (AL2) | 2.26 | EOL 2026-06-30; Lambda + EC2 + ECR still supported | ✗ fails to load | ✓ works |
| **Amazon Linux 2023** (AL2023) | 2.34 | GA 2023-03-15; Lambda default | ✓ works | ✓ works |
| **Ubuntu 20.04** | 2.31 | EOL April 2030 (LTS + Pro) | ✗ fails to load | ✓ works |
| **Ubuntu 22.04** | 2.35 | EOL April 2032 | ✓ works | ✓ works |
| **Debian 11** | 2.31 | EOL 2026-08-31 (freexian extended) | ✗ fails to load | ✓ works |
| **Debian 12** | 2.36 | EOL mid-2028 | ✓ works | ✓ works |

**The wins that matter most to our users**: RHEL 7 (Extended Lifecycle customers still running it in production), Amazon Linux 1 (pre-2023 Lambda deployments and long-lived EC2 AMIs), Amazon Linux 2 (the Lambda `nodejs18.x` default runtime through at least mid-2026), and Ubuntu 20.04 LTS (still the default in many enterprise CI systems).

This mirrors exactly the motivation [Bun's PR 29461](https://github.com/oven-sh/bun/pull/29461) used when they made the same move — "unblocks companies running Red Hat Enterprise Linux 7 & Amazon Linux 1 from using Bun." For us it's node-smol SEA binaries instead of Bun, but the deployment constraint is identical.

### Sources

- [Amazon Linux 2 FAQs — EOL and glibc](https://aws.amazon.com/amazon-linux-2/faqs/)
- [AL1 EOL announcement](https://aws.amazon.com/blogs/aws/update-on-amazon-linux-ami-end-of-life/)
- [AL2023 release cadence](https://docs.aws.amazon.com/linux/al2023/ug/release-cadence.html)
- [RHEL 7 Extended Lifecycle Support](https://access.redhat.com/support/policy/updates/errata)
- [Ubuntu release + LTS schedule](https://ubuntu.com/about/release-cycle)
- [Debian long-term support](https://wiki.debian.org/LTS)

---

## Goal

Lower our Linux glibc floor from **2.28** (AlmaLinux 8 / RHEL 8, today's default) to **2.17** (CentOS 7 / Amazon Linux 1 / aarch64 baseline). Once done, our `node-smol` SEA binary will run on every distribution in the table above without requiring users to upgrade their OS.

Why 2.17 and not lower? Because **2.17 is the ultimate aarch64 glibc floor**. Going lower on x64 alone has no value — users who want the same binary for arm64 are already stuck at 2.17. And going lower than 2.17 on x64 only unblocks CentOS 6 (EOL 2020-11-30, functionally dead) and older AL1 AMIs that will no longer boot on modern hypervisors. The 2.17 floor gets ~every commercially relevant host.

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

### Build image — `Dockerfile.glibc-2.17`

**File**: `packages/node-smol-builder/docker/Dockerfile.glibc-2.17`

Opt-in Dockerfile, **not wired into any workflow**. Multi-arch via `${TARGETARCH}`:

- Docker sets `TARGETARCH=amd64` for `linux/amd64` and `arm64` for `linux/arm64`.
- The `FROM` line rewrites `amd64 → x86_64` so `quay.io/pypa/manylinux2014_${TARGETARCH/amd64/x86_64}` selects the correct per-arch repository (`manylinux2014_x86_64` or `manylinux2014_aarch64`).
- Both arches pinned to the `2026.04.17-1` tag. Per-arch digests are documented inline in the Dockerfile for audit.
- C++20 via SCL `devtoolset-11` (GCC 11) — highest toolset available on CentOS 7 vault. `devtoolset-12/13/14` are AlmaLinux 8+ only.
- Build-time tripwire: `ldd --version` check fails the build if the base image ever drifts off glibc 2.17.

To invoke directly via Depot (same project as every other Linux build):

```bash
pnpm exec depot build \
  --project 8fpj9495vw \
  --file packages/node-smol-builder/docker/Dockerfile.glibc-2.17 \
  --platform linux/amd64,linux/arm64 \
  --output type=local,dest=./glibc-2.17-out \
  .
```

Depot's BuildKit is FROM-agnostic — the same cloud cache hosts our 2.28 and 2.17 images without collision. No new Depot project needed.

### Weekly audit workflow

**File**: `.github/workflows/glibc-audit.yml`

Runs `pnpm --filter node-smol-builder run glibc:audit --fallback-report` weekly (Mondays 08:00 UTC) against the latest published `node-smol-*` release asset. Floor defaults to today's baseline (`2.28`) and is a `workflow_dispatch` input so it can be flipped to `2.17` for a one-shot dry-run without editing the file. Skips cleanly if no release exists yet; surfaces any `✗ NO` (unwrapped) violations into the CI log.

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

**What**: Swap the CI Docker base from AlmaLinux 8 (glibc 2.28) to the glibc 2.17 image we've already built.

**Why blocking**: Phase 1's wraps are inert until the build environment itself uses the lower floor. Without swapping the image, `objdump` will keep finding `> 2.17` symbols because the compiler's glibc headers still reference them.

**Decision locked**: `Dockerfile.glibc-2.17` uses `quay.io/pypa/manylinux2014_${TARGETARCH/amd64/x86_64}:2026.04.17-1` + SCL `devtoolset-11`.

Why manylinux2014 and not AlmaLinux 7: pypa maintains this image actively (EOL 2027-05-04), the CentOS 7 vault fallback is already configured, and the dual-arch split (`manylinux2014_x86_64` vs `manylinux2014_aarch64`) matches our matrix. AlmaLinux 7 + SCL was the first-pass recommendation, but manylinux2014 ships SCL preconfigured, which skips a brittle `yum install centos-release-scl` step.

Why devtoolset-11 not 14: **CentOS 7 SCL vault caps at devtoolset-11**. Versions 12/13/14 exist only on AlmaLinux 8+ as `gcc-toolset-*`. GCC 11 has enough C++20 for Node.js v25.x; if a future Node version needs C++23 features not in GCC 11, move to `manylinux_2_28` (AlmaLinux 8, glibc 2.28) — but that defeats the glibc 2.17 floor.

**What's already done** (the Dockerfile exists; nothing to write):

- `packages/node-smol-builder/docker/Dockerfile.glibc-2.17` — multi-arch via `${TARGETARCH}`, pinned base tag, build-time `ldd` tripwire, uses `/opt/rh/devtoolset-11/enable`.
- Depot project `8fpj9495vw` already supports the FROM swap with zero config change — confirmed via [Depot container-builds docs](https://depot.dev/docs/container-builds/overview). BuildKit is FROM-agnostic.

**Verify before flipping**:

```bash
# 1. Full-matrix build via Depot.
pnpm exec depot build \
  --project 8fpj9495vw \
  --file packages/node-smol-builder/docker/Dockerfile.glibc-2.17 \
  --platform linux/amd64,linux/arm64 \
  --output type=local,dest=./glibc-2.17-out \
  .

# 2. Audit both binaries.
pnpm --filter node-smol-builder run glibc:audit -- \
  --binary=./glibc-2.17-out/node-smol-builder/build/prod/linux-x64/out/Final/node/node \
  --floor=2.17 --fallback-report
pnpm --filter node-smol-builder run glibc:audit -- \
  --binary=./glibc-2.17-out/node-smol-builder/build/prod/linux-arm64/out/Final/node/node \
  --floor=2.17 --fallback-report

# 3. Smoke-test both binaries on a CentOS 7 container.
for arch in x64 arm64; do
  docker run --rm --platform "linux/${arch/x64/amd64}" \
    -v ./glibc-2.17-out:/out quay.io/centos/centos:7 \
    /out/node-smol-builder/build/prod/linux-${arch}/out/Final/node/node -e 'console.log(process.version)'
done
```

If step 2 shows `✗ NO` rows (unwrapped symbols), extend `glibc_compat.cc` following the Phase 1 decision tree and re-run from step 1.

If step 3 prints the Node version on both arches without crashes, the binary works on glibc 2.17 — proceed to Phase 3.

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

## Testing the compat layer locally (without touching main CI)

You don't need to run the full phase plan to exercise the `glibc_compat.cc` fallback paths — you can do it today on any host that has Docker.

### Quick smoke test: build with the glibc-2.17 Dockerfile

We ship `packages/node-smol-builder/docker/Dockerfile.glibc-2.17` as groundwork. It is **not wired into any workflow** but can be invoked directly via Depot or local BuildKit to prove the compat layer compiles and links.

```bash
# Using Depot (the same setup CI uses):
pnpm exec depot build \
  --project 8fpj9495vw \
  --file packages/node-smol-builder/docker/Dockerfile.glibc-2.17 \
  --platform linux/amd64 \
  --output type=local,dest=./glibc-2.17-out \
  .

# Or with a local buildx (slower, no Depot cache):
docker buildx build \
  --file packages/node-smol-builder/docker/Dockerfile.glibc-2.17 \
  --platform linux/amd64 \
  --output type=local,dest=./glibc-2.17-out \
  .
```

The Dockerfile contains a build-time tripwire (`ldd --version | grep 2.17`) that fails the build if the base image drifts to a newer glibc. Exit 0 = your environment is actually 2.17.

### Audit a built binary

```bash
# Against any node binary you have locally (the script auto-detects the most
# recent Final build when --binary is omitted):
pnpm --filter node-smol-builder run glibc:audit -- --floor=2.17

# Explicit path + "which symbols are already wrapped?" annotations:
pnpm --filter node-smol-builder run glibc:audit -- \
  --binary=./glibc-2.17-out/node-smol-builder/build/prod/linux-x64/out/Final/node/node \
  --floor=2.17 \
  --fallback-report
```

Expected output on a 2.28-built binary with `--floor=2.17`: a table of violations, each annotated `✓ yes` or `✗ NO` depending on whether `glibc_compat.h` already declares a `__wrap_<symbol>()`. Any `✗ NO` means Phase 1 needs extending.

### Exercise the fallback path directly

The C++ fallbacks are only reachable when `dlsym(RTLD_NEXT, "<symbol>")` returns `nullptr`. On any glibc ≥ 2.18 host the dlsym call finds the real impl and the fallback never runs. Three ways to hit it:

1. **Actually run on glibc 2.17** (most realistic — CentOS 7 or Amazon Linux 1 container):
   ```bash
   docker run --rm -v "$PWD/glibc-2.17-out:/out" quay.io/centos/centos:7 \
     /out/node-smol-builder/build/prod/linux-x64/out/Final/node/node -e 'console.log(process.version)'
   ```
   If the linked binary runs and prints the Node version, all four wraps survive.

2. **Override `dlsym` at runtime with `LD_PRELOAD`** (for developers who want to unit-test the fallback without a 2.17 host). Write a small shim:
   ```c
   // force_null_dlsym.c — compile with: gcc -shared -fPIC -o force_null_dlsym.so force_null_dlsym.c
   #include <dlfcn.h>
   void* dlsym(void* handle, const char* symbol) {
     if (symbol && (!strcmp(symbol, "getrandom") ||
                    !strcmp(symbol, "quick_exit") ||
                    !strcmp(symbol, "at_quick_exit") ||
                    !strcmp(symbol, "__cxa_thread_atexit_impl"))) {
       return NULL;
     }
     // Forward to real dlsym via its own lookup.
     static void* (*real)(void*, const char*);
     if (!real) real = __builtin_dlsym(RTLD_NEXT, "dlsym");
     return real(handle, symbol);
   }
   ```
   Then `LD_PRELOAD=./force_null_dlsym.so ./node`. Confirms the fallback code actually runs.

3. **Audit-only dry run**: `pnpm run glibc:audit -- --floor=2.17 --fallback-report` against a built 2.28 binary — shows you exactly which fallbacks WOULD activate if you moved to 2.17 today.

### When you're done

If the compat layer ever activates on a real user system (crash reports mentioning `__wrap_getrandom` or similar), treat it as P0 — it means either:
- the host glibc is below our intended floor (check deployment/base-image drift), or
- the dlsym lookup failed for a non-version reason (sandboxing? SELinux?).

Keep incident notes in `packages/node-smol-builder/docs/plans/glibc-floor-lowering.md` if either case hits.

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
