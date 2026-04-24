# napi-go

Go → Node.js N-API framework. The Go-ecosystem counterpart to
[napi-rs](https://napi.rs/) and [Zig node-api](https://ziglang.org/).

napi-go is **source-distributed**. It does not ship prebuilt `.node`
binaries for downstream consumption. Downstream builders (e.g.
`ultraviolet-builder`) add `napi-go` as a workspace dependency, import
the Go package and the C shim, and produce their own per-platform-arch
`.node` artifacts.

The one binary this package does build is `examples/hello/`, a reference
binding used as a smoke test. It is not published.

## Status

Early. V1 surface covers synchronous value marshaling and Go-owned
handles. Threadsafe callbacks (Go goroutine → JS) and struct codegen
are deferred. See `src/` and `include/napi_go.h` for the actual surface.

## Downstream integration

A downstream builder wires in napi-go by:

1. Adding `"napi-go": "workspace:*"` to `dependencies`.
2. Declaring a Go entry file (`//export`s for each N-API function) plus
   a C shim that calls `napi_go_register` to bind them.
3. Calling `buildNapiGoAddon({ ... })` from `scripts/build.mts` — the
   same helper that builds `examples/hello` here.

See `examples/hello/` for the minimal shape and `cli/src/build.mts` for
the options accepted by the build driver.

## Toolchain

- Go >= 1.21 on `PATH` (`c-archive` mode + cgo).
- A C compiler (`clang` on macOS/Linux, MSVC or mingw on Windows).
- Node.js headers (automatically resolved from the running node
  executable during builds).

Go is not currently pinned via `build-infra`'s tool-checksums; follow
the system-toolchain pattern used by `iocraft-builder` for `rustc`.
