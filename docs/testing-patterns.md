# Testing Patterns

This document explains the different test script patterns used across socket-btm packages and when to use each approach.

## Overview

Socket-btm uses three main test patterns:

1. **Standard vitest** (`vitest run`) - Pure JavaScript/TypeScript packages
2. **Environment-aware vitest** (`dotenvx + vitest run`) - Tests requiring environment variables
3. **Makefile-wrapped tests** (`dotenvx + custom test.mjs`) - Packages with C/C++ code and native dependencies

---

## Pattern 1: Standard Vitest

**Command**: `vitest run`

**When to use**:
- Pure JavaScript/TypeScript packages
- No C/C++ compilation required
- No complex environment setup needed
- Standard test workflow: run tests directly

**Packages using this pattern**:
- `bin-infra` - Binary infrastructure utilities
- `bin-stubs` - Platform stub binaries (vitest tests only)
- `build-infra` - Build system utilities
- `codet5-models-builder` - Model builder
- `minilm-builder` - Model builder
- `models` - Packaged ML models
- `node-smol-builder` - Node.js builder
- `onnxruntime-builder` - ONNX Runtime builder
- `yoga-layout-builder` - Yoga Layout builder

**Example**:
```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

**Vitest configuration**:
- Extends base config from `vitest.config.mts`
- Uses `mergeConfig` to override specific settings
- Example override: timeouts, test pools, coverage settings

---

## Pattern 2: Environment-Aware Vitest

**Command**: `dotenvx run --env-file=.env.test -- vitest run`

**When to use**:
- Tests require environment variables for configuration
- Environment variables control test behavior (API endpoints, feature flags, etc.)
- No C/C++ compilation, but needs environment setup

**Packages using this pattern**:
- `binject` - Binary injection tool (requires test environment for LIEF operations)

**Example**:
```json
{
  "scripts": {
    "test": "dotenvx run --env-file=.env.test -- vitest run"
  }
}
```

**Environment file** (`.env.test`):
```bash
# Example test environment variables
NODE_ENV=test
LOG_LEVEL=debug
```

---

## Pattern 3: Makefile-Wrapped Tests

**Command**: `dotenvx run --env-file=.env.test -- node scripts/test.mjs`

**When to use**:
- Package contains C/C++ code compiled via Makefile
- Tests require native build artifacts (binaries, libraries)
- Need to check/install external tools before testing
- Need to ensure dependencies (LIEF, curl, lzfse) are available
- CI environment may not have required build tools (graceful skip needed)

**Packages using this pattern**:
- `binflate` - Decompression CLI (C/C++ + Makefile)
- `binpress` - Compression CLI (C/C++ + Makefile + LIEF)

**Example**:
```json
{
  "scripts": {
    "test": "dotenvx run --env-file=.env.test -- node scripts/test.mjs"
  }
}
```

### Custom test.mjs Script Structure

The custom `scripts/test.mjs` file follows this pattern:

```javascript
#!/usr/bin/env node
/**
 * Test script for [package] C package
 * Wraps the Makefile test target for pnpm integration
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')
const WIN32 = process.platform === 'win32'

// Helper to run commands with logging
function runCommand(command, args, cwd) { /* ... */ }

// Select platform-specific Makefile
function selectMakefile() {
  if (process.platform === 'linux') return 'Makefile.linux'
  if (process.platform === 'win32') return 'Makefile.windows'
  return 'Makefile.macos'
}

async function main() {
  try {
    // 1. Check and install required tools
    logger.info('Checking required tools...\n')
    try {
      await runCommand('node', [
        path.join(packageRoot, 'scripts', 'check-tools.mjs')
      ], packageRoot)
    } catch (checkError) {
      // Graceful skip in CI if tools unavailable
      if (process.env.CI) {
        logger.warn('Tool check failed in CI environment')
        logger.success('Tests skipped (dependencies not available)')
        process.exitCode = 0
        return
      }
      throw checkError
    }

    // 2. Ensure dependencies (LIEF, curl, etc.)
    logger.info('Ensuring dependencies are available...\n')
    await ensureDependencies()

    // 3. Check if binary exists (from checkpoint restoration)
    const binaryPath = path.join(packageRoot, 'build', 'dev', 'out', 'Final', 'binary')
    let binaryExists = false
    try {
      await access(binaryPath)
      binaryExists = true
      logger.info('Binary already exists, skipping build\n')
    } catch {
      binaryExists = false
    }

    // 4. Build if needed
    if (!binaryExists) {
      logger.info('Building binary...\n')
      try {
        const makefile = selectMakefile()
        await runCommand('make', ['-f', makefile, 'all'], packageRoot)
      } catch (buildError) {
        // Graceful skip in CI if build fails
        if (process.env.CI) {
          logger.warn('Build failed in CI environment')
          logger.success('Tests skipped (build dependencies not available)')
          process.exitCode = 0
          return
        }
        throw buildError
      }
    }

    // 5. Run tests via Makefile
    logger.info('Running tests...\n')
    const makefile = selectMakefile()
    await runCommand('make', ['-f', makefile, 'test'], packageRoot)
    logger.success('Tests passed!')
  } catch (error) {
    logger.fail(`Tests failed: ${error.message}`)
    process.exitCode = 1
  }
}

main()
```

### Key Features of Makefile-Wrapped Tests

1. **Tool Checking**: Runs `scripts/check-tools.mjs` to verify cmake, ninja, compilers, etc.
2. **Dependency Management**: Ensures LIEF, curl, or other dependencies are built/downloaded
3. **Checkpoint Awareness**: Skips build if binary exists (from checkpoint restoration)
4. **CI Graceful Skip**: If tools/dependencies unavailable in CI, skips tests with exit code 0
5. **Platform-Specific Makefiles**: Uses `Makefile.{platform}` for platform-specific builds
6. **Makefile Test Target**: Delegates actual test execution to `make test`

---

## Decision Tree: Which Pattern to Use?

```
Does your package have C/C++ code compiled via Makefile?
├─ YES → Use Pattern 3 (Makefile-Wrapped)
│         - Create scripts/test.mjs
│         - Wrap Makefile test target
│         - Add tool checking and dependency setup
│
└─ NO → Does your package need environment variables for tests?
          ├─ YES → Use Pattern 2 (Environment-Aware Vitest)
          │         - Add .env.test file
          │         - Use dotenvx + vitest run
          │
          └─ NO → Use Pattern 1 (Standard Vitest)
                    - Just use vitest run
                    - Extend base vitest.config.mts
```

---

## Vitest Configuration Patterns

All vitest configs should extend the base configuration:

```typescript
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../vitest.config.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Override base settings as needed
      testTimeout: 60_000,  // Override base 120s timeout
      pool: 'forks',        // Override base threads pool
    },
  }),
)
```

**Base config provides** (`vitest.config.mts`):
- Default timeout: 120s (2 minutes)
- Default hook timeout: 30s
- Coverage settings
- Test file patterns

**Common overrides**:
- `testTimeout`: Reduce for fast tests, increase for slow integration tests
- `hookTimeout`: Increase for slow setup (e.g., building curl, LIEF)
- `pool`: Use `'forks'` for tests requiring process isolation (e.g., binject)
- `poolOptions`: Configure fork behavior (singleFork, isolate)

---

## CI Considerations

### Graceful Test Skipping

Packages with native dependencies should gracefully skip tests in CI if build tools are unavailable:

```javascript
if (process.env.CI) {
  logger.warn('Build failed in CI environment (likely missing system dependencies)')
  logger.success('Tests skipped (dependencies not available)')
  process.exitCode = 0  // Not process.exit(0)!
  return
}
```

**Why**: CI runners may not have all native build tools (cmake, ninja, compilers), so tests should skip gracefully rather than failing.

**Important**: Use `process.exitCode = 0` + `return`, NOT `process.exit(0)`, to allow cleanup handlers to run.

### Checkpoint Restoration

The build system uses checkpoints to cache build artifacts:

```javascript
const binaryPath = path.join(packageRoot, 'build', 'dev', 'out', 'Final', 'binary')
try {
  await access(binaryPath)
  logger.info('Binary already exists (restored from checkpoint), skipping build\n')
  binaryExists = true
} catch {
  binaryExists = false
}
```

In CI, binpress rebuilds even if checkpoint exists to ensure embedded stubs are fresh:

```javascript
const shouldBuild = !binaryExists || process.env.CI
```

---

## Testing Best Practices

1. **Always extend base vitest config** - Use `mergeConfig` pattern for consistency
2. **Document timeout overrides** - Add comments explaining why timeouts are changed
3. **Use process.exitCode, not process.exit()** - Allows cleanup handlers to run
4. **Graceful CI skipping** - Native build packages should skip if dependencies unavailable
5. **Checkpoint awareness** - Check for existing binaries before rebuilding
6. **Platform-specific Makefiles** - Use separate Makefiles for macOS, Linux, Windows
7. **Tool checking** - Verify external dependencies before attempting build

---

## Examples

### Example 1: Standard Vitest Package

**package.json**:
```json
{
  "name": "build-infra",
  "scripts": {
    "test": "vitest run"
  }
}
```

**vitest.config.mts**:
```typescript
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../vitest.config.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Base config provides 120s timeout (sufficient for build tests)
    },
  }),
)
```

### Example 2: Environment-Aware Package

**package.json**:
```json
{
  "name": "binject",
  "scripts": {
    "test": "dotenvx run --env-file=.env.test -- vitest run"
  }
}
```

**.env.test**:
```bash
NODE_ENV=test
LOG_LEVEL=info
```

### Example 3: Makefile-Wrapped Package

**package.json**:
```json
{
  "name": "binpress",
  "scripts": {
    "test": "dotenvx run --env-file=.env.test -- node scripts/test.mjs"
  }
}
```

**scripts/test.mjs**:
```javascript
#!/usr/bin/env node
// 1. Check tools (cmake, ninja, etc.)
// 2. Ensure LIEF library available
// 3. Check for existing binary (checkpoint)
// 4. Build via Makefile if needed
// 5. Run tests via make test
// 6. Graceful skip in CI if dependencies unavailable
```

---

## Summary

| Pattern | Command | Use Case | Packages |
|---------|---------|----------|----------|
| Standard | `vitest run` | Pure JS/TS, no native deps | Most packages (9) |
| Environment-Aware | `dotenvx + vitest run` | Needs env vars for tests | binject |
| Makefile-Wrapped | `dotenvx + test.mjs` | C/C++ code, native deps | binflate, binpress |

Choose the simplest pattern that meets your package's requirements. Start with Pattern 1 (Standard Vitest) and only add complexity (environment variables, Makefile wrapping) when necessary.
