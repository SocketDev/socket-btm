# fs_shim.js -- Monkey-patches Node's `fs` module to intercept VFS paths

## What This File Does

This file replaces (or wraps) methods on Node's built-in `fs` module so
that when your code calls `fs.readFileSync('/snapshot/app.js')`, it
transparently reads from the embedded VFS archive instead of the real
filesystem. It handles both sync and async fs methods, plus special
cases like realpathSync.native and glob.

It also blocks write operations (writeFileSync, unlink, mkdir, etc.) to
VFS paths with EROFS ("read-only file system") errors, since the VFS is
immutable.

## How It Fits in the VFS System

bootstrap.js -> installs shims by calling installVFSShims(fs)
-> THIS FILE replaces fs.readFileSync, fs.statSync, etc.
-> When a /snapshot/_ or /sea/_ path is detected:
-> Delegates to loader.js (for VFS) or sea_path.js (for SEA assets)
-> When a normal path is detected:
-> Falls through to the original fs method (no change in behavior)

## Key Concepts

- Shimming / Monkey-patching: Replacing a function on an existing object
  with a new function that adds behavior. Example:
  const original = fs.readFileSync;
  fs.readFileSync = function(path, opts) {
  if (isVFSPath(path)) return readFromVFS(path, opts);
  return original(path, opts); // fall through to real fs
  };

- Handler-based pattern: Instead of simple monkey-patching, this file
  uses a "handler" object that fs methods check at the START of their
  function body. This ensures that even code that captured `readFileSync`
  before shims were installed still gets intercepted:
  const { readFileSync } = require('fs'); // captured early
  installVFSShims(fs); // installed later
  readFileSync('/snapshot/x'); // still intercepted!

- SEA vs VFS paths: Two virtual path prefixes are supported:
  /sea/_ -> Node.js SEA blob assets (via node:sea module)
  /snapshot/_ -> Socket VFS (embedded TAR archive)
  SEA paths are checked first, then VFS, then real filesystem.

- EROFS: "Read-Only File System" error code. Thrown when code tries to
  write to a VFS path (e.g., fs.writeFileSync('/snapshot/x', data)).

- Overlay mode: When VFS is configured with an extraction directory,
  paths can be "rewritten" from /snapshot/foo to ~/.socket/\_dlx/<hash>/foo
  so that extracted files on disk take priority over VFS contents.
