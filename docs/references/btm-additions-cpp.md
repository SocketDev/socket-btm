# BTM additions/ — C++ rules and SEA entry constraints

Detailed expansion of the `additions/` C++ section in `CLAUDE.md`.

## Why `-fno-exceptions`

Node.js compiles with `-fno-exceptions`. `std::bad_alloc` turns into `abort()` and kills the whole isolate. Every allocation touched at a binding entry point must use `std::nothrow` and check for null, then call `isolate->ThrowException(...)` on failure.

## Allocations at JS entrypoints

```cpp
auto* obj = new (std::nothrow) T(...);
if (obj == nullptr) {
  isolate->ThrowException(v8::Exception::Error(
      FIXED_ONE_BYTE_STRING(isolate, "Out of memory: ...")));
  return;  // or roll back any partial state first
}
```

For `std::make_unique`, use `std::unique_ptr<T>(new (std::nothrow) T(...))`. Helper classes — `FFIBinding::GetStateOrThrow`, `CheckObjectPoolOrThrow`, `CheckChunkPoolOrThrow` — consolidate this on hot call sites.

## STL containers

`std::unordered_map` and `std::vector` insertion can still `bad_alloc` through the allocator, and there is **no nothrow escape at the STL API level** — `emplace`, `insert`, `operator[]=` all go through the same allocator and `std::terminate()` on failure.

Mitigations:

- Call `.reserve(N)` once at state construction so typical-workload inserts never rehash. This narrows the failure surface to one bounded-small, one-time allocation.
- Cap user-controlled sizes before `.resize(n)` / `vector<T>(n)` with an explicit bound check.

## `String::Utf8Value`

Always null-check `*utf8` before dereferencing. The internal allocation can fail and leave `*utf8` as nullptr; `std::string::assign(nullptr)` or passing nullptr to libpq crashes.

```cpp
String::Utf8Value utf8(isolate, val);
if (*utf8 == nullptr) {
  isolate->ThrowException(...);
  return;
}
```

## Async libuv work

Async work that escapes the current stack (`uv_write`, `uv_queue_work`, `setTimeout`-style) MUST allocate its buffer/state on the heap alongside the libuv request — never on the stack — and `delete` in the callback. Stack buffers passed to async `uv_write` are a use-after-stack bug (libuv reads the buffer at send time, not at `uv_write()` call time).

If the uv call returns non-zero, the callback will NOT fire — the caller owns the state and must `delete` it on the error path.

## Includes

ALWAYS use full `socketsecurity/...` include paths (e.g., `#include "socketsecurity/http/http_fast_response.h"`). Include `env-inl.h` if the .cc uses `Environment*` methods, otherwise `env.h`.

## SEA entry: require-from-VFS route

Node 25.7+ replaces the ambient `require` inside a CJS SEA entry with embedder hooks that only resolve built-in module names. External loads (file://, absolute paths, VFS paths) fail with `ERR_UNKNOWN_BUILTIN_MODULE`. ALWAYS use `Module.createRequire(scriptPath)` to get a require function that bypasses those hooks — `createVFSRequire()` in `internal/socketsecurity/smol/bootstrap.js` already does this correctly. NEVER replace that helper with `await import(pathToFileURL(...))`; the `import()` hooks have the same limitation in 25.7+.
