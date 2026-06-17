# V8 Pointer Compression in node-smol

smol-Node is built with `--experimental-enable-pointer-compression` (see
`packages/node-smol-builder/scripts/binary-released/shared/build-released.mts:631`).
V8 uses 32-bit compressed pointers instead of 64-bit native pointers, cutting
heap memory ~50% on pointer-heavy workloads.

## What it costs

Two constraints come with the compression:

1. **4 GB heap cap per V8 isolate.** Each isolate can address ≤ 4 GB.
   Worker threads each get their own 4 GB isolate, so a process with the
   main thread + 4 workers can hold ~20 GB total — but no single thread
   can exceed 4 GB. Affects: long-lived processes holding large in-memory
   caches, batch jobs that load >4 GB of JSON, anything that today sets
   `--max-old-space-size=8192`.

2. **Native addons using the legacy V8 API (`nan`) may crash.** Pointer
   compression changes the shape V8 hands native code. N-API (Node-API)
   addons are unaffected — N-API abstracts over the V8 API and the V8
   maintainers test it against pointer compression. The `nan` library
   pre-dates N-API and reaches into V8 internals directly; addons built
   against `nan` segfault on smol-Node.

   **Tested + working** (per platformatic/node-caged benchmarks):
   - `bcrypt`, `sharp`, `@napi-rs/uuid`, `@node-rs/argon2` (all N-API).

   **Tested + crashes**:
   - `better-sqlite3` (uses `nan`).

   **For downstream users:** prefer N-API alternatives. The Node ecosystem
   has largely migrated; `nan` is being phased out across the board.

## What it buys (benchmark reference)

platformatic/node-caged published the canonical pointer-compression
benchmarks on Node 25 / 26:

| Data structure        | Standard Node | Pointer-compressed | Savings |
| --------------------- | ------------- | ------------------ | ------- |
| Array of 1M objects   | 40.47 MB      | 20.24 MB           | 50%     |
| 500K nested objects   | 50.21 MB      | 24.64 MB           | 51%     |
| 500K-node linked list | 19.08 MB      | 9.54 MB            | 50%     |
| 500K array-of-arrays  | 38.76 MB      | 19.38 MB           | 50%     |

E-commerce SSR workload (Trading Card Marketplace, Next.js + Postgres):
~50% memory at +2-4% latency. Hello-world SSR hits the worst case at
~+56% latency — counterintuitively, because hello-world is dominated by
the per-request overhead pointer compression adds, not the heap-pointer
density it saves.

Source: <https://blog.platformatic.dev/we-cut-nodejs-memory-in-half>

## How to verify on a running smol-Node

```bash
node -e 'console.log(v8.getHeapStatistics().heap_size_limit / 1024 / 1024)'
```

Pointer-compressed: ~4096 (4 GB). Standard Node: typically ~2048 or
~4096 depending on `--max-old-space-size`, but pushes higher with the
flag set.

A 1 MB object array shows ~20 B/item rather than ~40 B/item on
smol-Node — half the bytes-per-pointer.

## Why we ship this

smol-Node targets embedded + serverless workloads where memory is the
constraint, not addon ecosystem breadth. The 50% heap reduction
matters more than `better-sqlite3` compatibility for the use case we're
optimizing.
