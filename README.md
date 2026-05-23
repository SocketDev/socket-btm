# Socket BTM

Build infrastructure for Socket's binary artifacts and ML models.

## Why this repo exists

Socket BTM (Binary Tooling Manager) is Socket Security's build infrastructure for creating custom Node.js binaries, manipulating compiled binaries, and producing quantized ML models. We need it because Socket ships:

- A patched Node.js binary (~23-27MB) with security enhancements and embedded capabilities (VFS, SEA).
- Tools to inject data into binaries post-compile (binject) and compress/decompress them while preserving functionality (binpress, binflate).
- Optimized ML models for security analysis (CodeT5, MiniLM, ONNX Runtime, Yoga Layout).
- Native bindings and UI libraries (OpenTUI, Ultraviolet) compiled from C/C++/Go/Zig sources.

The repo is for developers working on Socket's internal tools, contributing to Socket's open-source projects, or building custom Node.js distributions. Not user-facing.

## Install

```sh
pnpm install
```

`binject` / `binpress` depend on a prebuilt LIEF artifact, and `stubs-builder` depends on prebuilt curl+mbedTLS; both are fetched automatically from this repo's GitHub releases on first build. Pass `pnpm --filter <builder> run build -- --force` if you need to compile those libraries from source (e.g. an unsupported platform or a LIEF/curl bump that hasn't been published yet).

## Usage

```sh
# Build binary tools
pnpm --filter binject run build
pnpm --filter binpress run build
pnpm --filter binflate run build

# Build Node.js
pnpm --filter node-smol-builder run build

# Build WASM modules
pnpm --filter onnxruntime-builder run build
pnpm --filter yoga-layout-builder run build

# Build ML models
pnpm --filter codet5-models-builder run build
pnpm --filter minilm-builder run build
pnpm --filter models run build
```

### Core concepts

If you're new to binary manipulation or Node.js customization, here are the key concepts you'll encounter:

**Single Executable Application (SEA)** — A Node.js program bundled into a single executable file. Instead of shipping `node` + `.js` files, you get one binary that contains everything. Example: `my-app.exe` contains both Node.js runtime and your application code.

**Virtual File System (VFS)** — A filesystem embedded inside a binary. Your executable can read "files" that are actually data baked into the binary itself. Example: your binary contains `config.json` and `index.js` internally, accessed via normal `fs.readFile()` calls.

**Binary Injection** — Modifying a compiled binary without recompiling from source. We insert data into special sections of executables (Mach-O on macOS, ELF on Linux, PE on Windows). Example: take `node` binary, inject a VFS archive into it, output `node-with-vfs`.

**LIEF (Library for Instrumenting Executable Formats)** — A C++ library for reading and modifying executable formats. We use it to inject data into binaries safely without corrupting them.

**Checkpoints** — Build caching. Long builds (Node.js, ONNX Runtime) cache intermediate state so re-runs skip already-completed phases.

**Compression (zstd)** — Facebook's zstandard compression algorithm. Used for binpress/binflate to ship smaller binaries.

### Packages

| Category            | Package                                                                | Purpose                                                           |
| ------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Binary tools**    | [binject](packages/binject/)                                           | Binary injection (Mach-O, ELF, PE)                                |
|                     | [binpress](packages/binpress/)                                         | Binary compression (zstd)                                         |
|                     | [binflate](packages/binflate/)                                         | Binary decompression utility                                      |
| **Infrastructure**  | [build-infra](packages/build-infra/)                                   | Shared build utilities (checkpoints, CMake, Rust, WASM)           |
|                     | [bin-infra](packages/bin-infra/)                                       | Binary infrastructure (LIEF, compression, format handling)        |
|                     | [stubs-builder](packages/stubs-builder/)                               | Self-extracting stub binaries for compressed executables          |
|                     | [curl-builder](packages/curl-builder/)                                 | Curl static library builder                                       |
|                     | [lief-builder](packages/lief-builder/)                                 | LIEF library builder                                              |
|                     | [libpq-builder](packages/libpq-builder/)                               | libpq PostgreSQL client library with OpenSSL support              |
| **Node.js**         | [node-smol-builder](packages/node-smol-builder/)                       | Custom Node.js v26 with Socket security patches                   |
| **WASM builders**   | [onnxruntime-builder](packages/onnxruntime-builder/)                   | ONNX Runtime WASM module builder                                  |
|                     | [yoga-layout-builder](packages/yoga-layout-builder/)                   | Yoga Layout WASM module builder                                   |
| **UI libraries**    | [opentui-builder](packages/opentui-builder/)                           | Native Node.js bindings for OpenTUI library via Zig node-api      |
|                     | [ultraviolet-builder](packages/ultraviolet-builder/)                   | Charmbracelet Ultraviolet terminal decoder (kitty/fixterms/SGR)   |
| **N-API**           | [napi-go-infra](packages/napi-go-infra/)                               | Go → N-API framework (the napi-rs analog for Go)                  |
| **ML models**       | [codet5-models-builder](packages/codet5-models-builder/)               | CodeT5 model quantization                                         |
|                     | [minilm-builder](packages/minilm-builder/)                             | MiniLM model quantization                                         |
|                     | [models](packages/models/)                                             | ML model distribution package                                     |

## Development

<details>
<summary>Contributor commands</summary>

```sh
pnpm install   # installs deps + sets up git hooks via Husky's prepare script
pnpm test      # run tests
pnpm lint      # lint
```

### Git hooks

This repository uses [Husky](https://typicode.github.io/husky/) for git hooks:

**Pre-commit hook** (optional quality checks):

- Runs linting on staged files (`pnpm lint --staged`)
- Runs tests on staged test files (`pnpm test --staged`)
- Can be bypassed with `git commit --no-verify` for fast local commits, history operations (squash, rebase, amend), or emergency hotfixes
- Selectively disable checks with environment variables:
  - `DISABLE_PRECOMMIT_LINT=1` — skip linting
  - `DISABLE_PRECOMMIT_TEST=1` — skip testing

**Pre-push hook** (mandatory security checks):

- Runs security validation before pushing to remote
- Cannot be bypassed

**Windows requirements**: git hooks use bash scripts and require [Git Bash](https://gitforwindows.org/) or [WSL](https://docs.microsoft.com/en-us/windows/wsl/install) on Windows systems.

</details>

## License

MIT
