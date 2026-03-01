# fast-webstreams Primordials Transformation Reference

## Overview

This document maps all built-in prototype methods found in `experimental-fast-webstreams` to their primordial equivalents. These transforms MUST be applied during the ES→CJS sync process by `scripts/vendor-fast-webstreams/sync.mjs`.

## Why Primordials?

The vendored code runs during Node.js early bootstrap in `additions/` directory before userland code executes. Using primordials protects against prototype pollution attacks that could compromise the runtime.

---

## Transformation Patterns

### Object Methods

| Original | Primordial | Example |
|----------|------------|---------|
| `Object.create(proto)` | `ObjectCreate(proto)` | `ObjectCreate(null)` |
| `Object.assign(target, ...sources)` | `ObjectAssign(target, ...sources)` | `ObjectAssign(opts, defaults)` |
| `Object.defineProperty(obj, prop, desc)` | `ObjectDefineProperty(obj, prop, desc)` | `ObjectDefineProperty(ctrl, 'byobRequest', desc)` |
| `Object.getOwnPropertyDescriptor(obj, prop)` | `ObjectGetOwnPropertyDescriptor(obj, prop)` | `ObjectGetOwnPropertyDescriptor(Response.prototype, 'body')` |
| `Object.getPrototypeOf(obj)` | `ObjectGetPrototypeOf(obj)` | `ObjectGetPrototypeOf(async function* () {}.prototype)` |
| `Object.setPrototypeOf(obj, proto)` | `ObjectSetPrototypeOf(obj, proto)` | `ObjectSetPrototypeOf(FastRS.prototype, NativeRS.prototype)` |
| `Object.keys(obj)` | `ObjectKeys(obj)` | `ObjectKeys(_stats)` |

### Promise Methods

| Original | Primordial | Example |
|----------|------------|---------|
| `Promise.resolve(val)` | `PromiseResolve(val)` | `PromiseResolve(undefined)` |
| `Promise.reject(err)` | `PromiseReject(err)` | `PromiseReject(new TypeError('locked'))` |

### Math Methods

| Original | Primordial | Example |
|----------|------------|---------|
| `Math.min(a, b)` | `MathMin(a, b)` | `MathMin(src.byteLength, remaining)` |
| `Math.max(a, b)` | `MathMax(a, b)` | `MathMax(0, queueSize - pendingReads)` |
| `Math.ceil(x)` | `MathCeil(x)` | `MathCeil(size / BLOCK_SIZE)` |

### Number Methods

| Original | Primordial | Example |
|----------|------------|---------|
| `Number.isNaN(x)` | `NumberIsNaN(x)` | `NumberIsNaN(hwm)` |

### JSON Methods

| Original | Primordial | Example |
|----------|------------|---------|
| `JSON.stringify(obj)` | `JSONStringify(obj)` | `JSONStringify(arg)` |

---

## Prototype Methods

### String Prototype

| Method | Pattern | Primordial | Example |
|--------|---------|------------|---------|
| `.startsWith()` | `str.startsWith(search)` | `StringPrototypeStartsWith(str, search)` | `StringPrototypeStartsWith(path, prefix)` |
| `.includes()` | `str.includes(search)` | `StringPrototypeIncludes(str, search)` | `StringPrototypeIncludes(str, '..')` |
| `.indexOf()` | `str.indexOf(search)` | `StringPrototypeIndexOf(str, search)` | `StringPrototypeIndexOf(data, ' ')` |
| `.slice()` | `str.slice(start, end)` | `StringPrototypeSlice(str, start, end)` | `StringPrototypeSlice(path, 0, 16)` |
| `.substring()` | `str.substring(start, end)` | `StringPrototypeSubstring(str, start, end)` | `StringPrototypeSubstring(data, pos, idx)` |
| `.replace()` | `str.replace(pattern, replacement)` | `StringPrototypeReplace(str, pattern, replacement)` | `StringPrototypeReplace(path, /\\\\/g, '/')` |
| `.trim()` | `str.trim()` | `StringPrototypeTrim(str)` | `StringPrototypeTrim(input)` |
| `.split()` | `str.split(sep)` | `StringPrototypeSplit(str, sep)` | `StringPrototypeSplit(env, ',')` |

### Array Prototype

| Method | Pattern | Primordial | Example |
|--------|---------|------------|---------|
| `.map()` | `arr.map(fn)` | `ArrayPrototypeMap(arr, fn)` | `ArrayPrototypeMap(entries, name => ...)` |
| `.filter()` | `arr.filter(fn)` | `ArrayPrototypeFilter(arr, fn)` | `ArrayPrototypeFilter(results, r => r.status === 'rejected')` |
| `.push()` | `arr.push(item)` | `ArrayPrototypePush(arr, item)` | `ArrayPrototypePush(entries, name)` |
| `.slice()` | `arr.slice(start, end)` | `ArrayPrototypeSlice(arr, start, end)` | `ArrayPrototypeSlice(args, argIndex)` |
| `.join()` | `arr.join(sep)` | `ArrayPrototypeJoin(arr, sep)` | `ArrayPrototypeJoin(errors, '\\n')` |

### Map Prototype

| Method | Pattern | Primordial | Example |
|--------|---------|------------|---------|
| `.get()` | `map.get(key)` | `MapPrototypeGet(map, key)` | `MapPrototypeGet(vfs, vfsPath)` |
| `.set()` | `map.set(key, val)` | `MapPrototypeSet(map, key, val)` | `MapPrototypeSet(files, name, entry)` |
| `.has()` | `map.has(key)` | `MapPrototypeHas(map, key)` | `MapPrototypeHas(cache, path)` |
| `.delete()` | `map.delete(key)` | `MapPrototypeDelete(map, key)` | `MapPrototypeDelete(cache, path)` |
| `.keys()` | `map.keys()` | `MapPrototypeKeys(map)` | `MapPrototypeKeys(vfsMap)` |

### TypedArray Methods

**CAUTION**: TypedArray `.set()` is for copying bytes, NOT Map operations!

| Method | Pattern | Primordial | Example |
|--------|---------|------------|---------|
| `.set()` | `uint8.set(src)` | `TypedArrayPrototypeSet(uint8, src)` | `TypedArrayPrototypeSet(dst, src)` |
| `.subarray()` | `uint8.subarray(start, end)` | `TypedArrayPrototypeSubarray(uint8, start, end)` | `TypedArrayPrototypeSubarray(src, 0, toCopy)` |

---

## Constructor Replacements

| Original | Primordial | Notes |
|----------|------------|-------|
| `new Map()` | `new SafeMap()` | Prototype-safe Map constructor |
| `new Set()` | `new SafeSet()` | Prototype-safe Set constructor |

---

## Safe References for Module APIs

**CRITICAL**: While not traditional primordials, module APIs can also be tampered with by user code. Capture safe references early in bootstrap before any user code runs.

### Why Module API References Are Needed

Users can overwrite module methods:
```javascript
// User code can tamper with these
Buffer.prototype.slice = () => 'hacked'
Buffer.from = () => 'hacked'
path.join = () => 'hacked'
fs.readFileSync = () => 'hacked'
process.execPath = 'hacked'
```

### Safe Reference Module

Socket Security uses `internal/socketsecurity/safe-references.js` to capture early references to all module APIs used in bootstrap code.

**IMPORTANT**: Buffer prototype methods use the `uncurryThis` pattern from Node.js primordials to allow calling with buffer as first argument:
```javascript
// uncurryThis pattern: transforms methods to accept `this` as first argument
const { bind, call } = Function.prototype
const uncurryThis = bind.bind(call)

const BufferPrototypeSlice = uncurryThis(Buffer.prototype.slice)
const BufferPrototypeToString = uncurryThis(Buffer.prototype.toString)

// Usage: BufferPrototypeSlice(buffer, 0, 10) instead of buffer.slice(0, 10)
```

### Buffer References

| Original | Safe Reference | Example |
|----------|----------------|---------|
| `buffer.slice(start, end)` | `BufferPrototypeSlice(buffer, start, end)` | `BufferPrototypeSlice(tarBuffer, offset, offset + size)` |
| `buffer.toString(encoding)` | `BufferPrototypeToString(buffer, encoding)` | `BufferPrototypeToString(buffer, 'utf8', start, end)` |
| `Buffer.alloc(size)` | `BufferAlloc(size)` | `BufferAlloc(512)` |
| `Buffer.from(data)` | `BufferFrom(data)` | `BufferFrom(vfsBlob)` |

### Path Module References

| Original | Safe Reference | Example |
|----------|----------------|---------|
| `path.join(a, b)` | `PathJoin(a, b)` | `PathJoin(dirname, filename)` |
| `path.resolve(p)` | `PathResolve(p)` | `PathResolve(this._cacheDir)` |
| `path.dirname(p)` | `PathDirname(p)` | `PathDirname(targetPath)` |
| `path.basename(p)` | `PathBasename(p)` | `PathBasename(filepath)` |
| `path.relative(from, to)` | `PathRelative(from, to)` | `PathRelative(base, vfsPath)` |
| `path.sep` | `PathSep` | `resolvedPath + PathSep` |

### Filesystem Module References

| Original | Safe Reference | Example |
|----------|----------------|---------|
| `fs.existsSync(p)` | `FsExistsSync(p)` | `FsExistsSync(cachedPath)` |
| `fs.mkdirSync(p, opts)` | `FsMkdirSync(p, opts)` | `FsMkdirSync(dirname, { recursive: true })` |
| `fs.writeFileSync(p, data)` | `FsWriteFileSync(p, data)` | `FsWriteFileSync(targetPath, content)` |
| `fs.readFileSync(p)` | `FsReadFileSync(p)` | `FsReadFileSync(path, 'utf8')` |
| `fs.readdirSync(p)` | `FsReaddirSync(p)` | `FsReaddirSync(dirname)` |
| `fs.statSync(p)` | `FsStatSync(p)` | `FsStatSync(filepath)` |
| `fs.chmodSync(p, mode)` | `FsChmodSync(p, mode)` | `FsChmodSync(targetPath, 0o755)` |
| `fs.copyFileSync(src, dst)` | `FsCopyFileSync(src, dst)` | `FsCopyFileSync(linkPath, targetPath)` |
| `fs.symlinkSync(target, path)` | `FsSymlinkSync(target, path)` | `FsSymlinkSync(linkTarget, targetPath)` |
| `fs.rmSync(p, opts)` | `FsRmSync(p, opts)` | `FsRmSync(tempDir, { recursive: true })` |
| `fs.promises.mkdir(p)` | `FsMkdir(p)` | `await FsMkdir(dirname, { recursive: true })` |
| `fs.promises.writeFile(p, data)` | `FsWriteFile(p, data)` | `await FsWriteFile(path, content)` |

### Process References

| Original | Safe Reference | Example |
|----------|----------------|---------|
| `process.execPath` | `ProcessExecPath` | `if (ProcessExecPath === '/usr/bin/node')` |
| `process.platform` | `ProcessPlatform` | `if (ProcessPlatform === 'win32')` |
| `process.argv` | `ProcessArgv` | `ProcessArgv[1] = entrypoint` |
| `process.env` | `ProcessEnv` | `ProcessEnv.NODE_DEBUG_VFS` |
| `process.versions` | `ProcessVersions` | `ProcessVersions.smol = '1.0.0'` |
| `process.stderr.write(msg)` | `ProcessStderrWrite(msg)` | `ProcessStderrWrite('[debug] message\n')` |
| `process._rawDebug(msg)` | `ProcessRawDebug(msg)` | `ProcessRawDebug('VFS: Init')` |

**Note**: `ProcessStderrWrite` is bound using `FunctionPrototypeBind` to prevent tampering via `process.stderr.write = malicious`.

### Crypto Module References

| Original | Safe Reference | Example |
|----------|----------------|---------|
| `crypto.createHash(algo)` | `CryptoCreateHash(algo)` | `CryptoCreateHash('sha256').update(data)` |

### Usage Pattern

**Import early in file (before any user code):**
```javascript
const {
  BufferPrototypeSlice,
  BufferPrototypeToString,
  PathJoin,
  PathResolve,
  FsExistsSync,
  FsMkdirSync,
  ProcessPlatform,
} = require('internal/socketsecurity/safe-references')
```

**Benefits:**
- Defense-in-depth against method tampering
- Consistent with primordials philosophy
- Works even if user code modifies module exports
- Performance: No property lookups through potentially tampered objects

**Fast-WebStreams Integration:**
When syncing fast-webstreams, cherry-pick Buffer and path references as needed:
```javascript
const {
  BufferPrototypeSlice,
  BufferPrototypeToString,
  BufferFrom,
} = require('internal/socketsecurity/safe-references')
```

---

## Implementation Notes

### 1. **Regex Formatting**

When using `StringPrototypeReplace()` with regex, split pattern and replacement across lines for lint:

```javascript
// ✓ CORRECT
StringPrototypeReplace(
  str,
  /\0.*$/,
  '',
)

// ✗ WRONG (lint error)
StringPrototypeReplace(str, /\0.*$/, '')
```

### 2. **Optional Chaining**

Primordials don't support optional chaining. Convert:

```javascript
// Before
const value = map?.get(key)

// After
const value = map ? MapPrototypeGet(map, key) : undefined
```

### 3. **Method Chaining**

Break chained method calls into separate primordial calls:

```javascript
// Before
const result = str.trim().replace(/\0.*$/, '').slice(0, 10)

// After
const trimmed = StringPrototypeTrim(str)
const replaced = StringPrototypeReplace(trimmed, /\0.*$/, '')
const result = StringPrototypeSlice(replaced, 0, 10)
```

### 4. **Import Order**

Import primordials alphabetically at the top of each file:

```javascript
const {
  ArrayPrototypeMap,
  MapPrototypeGet,
  MathMin,
  ObjectCreate,
  PromiseResolve,
  StringPrototypeReplace,
} = primordials
```

### 5. **Performance Optimization: Check Order**

**IMPORTANT**: Place cheap comparisons BEFORE expensive primordial calls in conditional expressions.

Primordial function calls have overhead compared to simple comparisons. Optimize short-circuit evaluation by checking cheap conditions first:

```javascript
// ✗ WRONG - Expensive primordial call happens first
if (StringPrototypeStartsWith(filepath, normalizedDir) && filepath !== normalizedDir) {
  // ...
}

// ✓ CORRECT - Cheap comparison short-circuits before expensive call
if (filepath !== normalizedDir && StringPrototypeStartsWith(filepath, normalizedDir)) {
  // ...
}
```

**Examples of cheap vs expensive checks:**
- **Cheap**: `x !== y`, `x === y`, `x > y`, `!x`, `typeof x === 'string'`
- **Expensive**: Any primordial call (`StringPrototypeStartsWith()`, `MapPrototypeGet()`, etc.)

**Common patterns to optimize:**

```javascript
// Pattern 1: Equality check before string operation
// ✗ WRONG
if (!StringPrototypeStartsWith(vfsPath, `${base}/`) && vfsPath !== base)

// ✓ CORRECT
if (vfsPath !== base && !StringPrototypeStartsWith(vfsPath, `${base}/`))

// Pattern 2: Truthy check before primordial
// ✗ WRONG
if (StringPrototypeIncludes(str, search) && str.length > 0)

// ✓ CORRECT
if (str.length > 0 && StringPrototypeIncludes(str, search))
```

**Why this matters:**
- Primordial calls are function calls with argument passing overhead
- Simple comparisons (`===`, `!==`) are inline operations
- Short-circuit evaluation prevents unnecessary function calls
- Critical for hot paths in loops and frequently-called functions

### 6. **Prefer Direct Comparison Over ArrayPrototypeIncludes**

When checking if a value matches one of a few known constants, use direct `===` comparisons instead of `ArrayPrototypeIncludes()`.

```javascript
// ✗ WRONG - Expensive array allocation + function call
if (ArrayPrototypeIncludes(['foo', 'bar', 'baz'], value)) {
  // ...
}

// ✓ CORRECT - Direct comparisons are much faster
if (value === 'foo' || value === 'bar' || value === 'baz') {
  // ...
}
```

**Real-world example from loader.js:**

```javascript
// ✗ SUBOPTIMAL (but acceptable if array is reused)
const validModes = [VFS_MODE_ON_DISK, VFS_MODE_IN_MEMORY, VFS_MODE_COMPAT]
if (envMode && ArrayPrototypeIncludes(validModes, envMode)) {
  // ...
}

// ✓ BETTER - Direct comparison avoids array allocation and includes() overhead
if (envMode && (
  envMode === VFS_MODE_ON_DISK ||
  envMode === VFS_MODE_IN_MEMORY ||
  envMode === VFS_MODE_COMPAT
)) {
  // ...
}
```

**When to use ArrayPrototypeIncludes:**
- ✅ When the array already exists and is reused
- ✅ When checking many values (10+) where an array is more maintainable
- ✅ When the values are dynamic or computed

**When to use direct comparison:**
- ✅ Checking against 2-5 known constants
- ✅ Hot code paths called frequently
- ✅ Bootstrap code where every microsecond counts

**Performance impact:**
- Direct comparison: ~1-2 CPU cycles (inline operation)
- ArrayPrototypeIncludes: ~20-50 CPU cycles (function call + array iteration)
- In hot paths with millions of calls, this can save significant CPU time

---

## File-Specific Transforms

### High-Priority Files (Most Violations)

Based on survey of fast-webstreams@0.5.0:

| File | Violations | Primary Methods |
|------|------------|-----------------|
| `readable.js` | ~40 | Object.*, Promise.*, Math.*, Array.* |
| `writable.js` | ~25 | Object.*, Promise.*, Math.* |
| `controller.js` | ~30 | Math.min/max, TypedArray.set, Number.isNaN |
| `patch.js` | ~20 | Object.create, Object.defineProperty, Object.getOwnPropertyDescriptor |
| `transform.js` | ~15 | Object.create, Promise.resolve/reject |
| `pipe-to.js` | ~10 | Promise.reject |
| `reader.js` | ~10 | Promise.resolve/reject |
| `writer.js` | ~10 | Promise.reject |

### Low-Priority Files (Few/No Violations)

| File | Violations | Notes |
|------|------------|-------|
| `utils.js` | 1 | Object.keys only |
| `byob-reader.js` | ~15 | Promise methods |
| `materialize.js` | 2 | Object.getPrototypeOf, Object.defineProperty |

---

## Sync Script Integration

The `scripts/vendor-fast-webstreams/sync.mjs` script MUST apply these transforms automatically during ES→CJS conversion.

**Recommended approach:**

1. Parse JavaScript AST using a simple regex-based transformer
2. Apply primordials transforms before circular dependency fixes
3. Add primordials import at top of each file
4. Preserve existing functionality and whitespace where possible

**Critical ordering:**

```
ES modules → CJS conversion
    ↓
Primordials transforms (THIS STEP)
    ↓
Circular dependency fixes
    ↓
Path resolution fixes
    ↓
Export statement fixes
```

---

## Testing

After applying primordials transforms:

1. **Build**: `pnpm --filter node-smol-builder clean && pnpm --filter node-smol-builder build`
2. **Quick validation**: `node scripts/vendor-fast-webstreams/validate.mjs` (15 tests)
3. **WPT validation**: `node scripts/vendor-fast-webstreams/wpt/validate.mjs` (1,116 tests)

All tests must pass at same rate as before transforms (98.5% WPT pass rate).

---

## Future Updates

When updating fast-webstreams to a new version:

1. Survey new code for additional built-in method usage
2. Update this reference with new patterns
3. Update sync.mjs transformer logic
4. Run full validation suite

---

**Last Updated**: 2026-02-25
**fast-webstreams Version**: 0.5.0
**Survey Baseline**: ~100+ primordial conversions needed
