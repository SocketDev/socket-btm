# Build Infrastructure & Ninja Integration Proposal

Analysis of how `packages/build-infra` should handle build tooling for socket-btm, including Ninja build system support.

## Current State

### socket-cli Workflow (Reference)

**Ninja Integration** (lines 370-407 in build-smol.yml):
```yaml
- name: Cache Ninja (Ubuntu)
  id: ninja-cache-ubuntu
  uses: actions/cache@v4
  with:
    path: /usr/bin/ninja
    key: ninja-ubuntu-${{ runner.os }}-${{ runner.arch }}

- name: Install Ninja (Ubuntu)
  if: steps.ninja-cache-ubuntu.outputs.cache-hit != 'true'
  run: sudo apt-get install -y ninja-build

- name: Cache Ninja (macOS)
  id: ninja-cache-macos
  uses: actions/cache@v4
  with:
    path: |
      /usr/local/bin/ninja
      /opt/homebrew/bin/ninja
    key: ninja-macos-${{ runner.os }}-${{ runner.arch }}

- name: Install Ninja (macOS)
  if: steps.ninja-cache-macos.outputs.cache-hit != 'true'
  run: brew install ninja

- name: Cache Ninja (Windows)
  id: ninja-cache-windows
  uses: actions/cache@v4
  with:
    path: C:\ProgramData\chocolatey\bin\ninja.exe
    key: ninja-windows-${{ runner.os }}-${{ runner.arch }}

- name: Install Ninja (Windows)
  if: steps.ninja-cache-windows.outputs.cache-hit != 'true'
  run: choco install ninja
```

**Why Ninja?**
- Node.js uses GYP to generate Ninja build files by default on Linux/macOS
- Ninja is significantly faster than Make for incremental builds
- Parallel build orchestration optimized for C++ compilation
- Socket-cli explicitly uses Ninja for all platforms except Windows

### socket-btm Current Workflow

**Problems**:
1. ❌ Inline Ninja installation in workflow (lines 370-407)
2. ❌ Platform-specific cache paths hardcoded
3. ❌ Repeated logic across cache/install steps
4. ❌ No abstraction for build toolchain setup
5. ❌ Windows Visual Studio setup in workflow (100+ lines)

### packages/build-infra Current State

**What Exists** (tool-installer.mjs):
```javascript
export function detectPackageManagers()
export function ensureToolInstalled(tool, options)
export function installTool(tool, packageManager, options)
export function getInstallInstructions(tool)
```

**What's Missing**:
- ❌ Ninja tool configuration
- ❌ Platform-specific binary path detection
- ❌ Build tool caching utilities
- ❌ Visual Studio environment setup
- ❌ Windows toolchain utilities

## Proposed Architecture

### 1. Add Ninja to tool-installer.mjs

**Location**: `packages/build-infra/lib/tool-installer.mjs`

**Add to TOOL_CONFIGS**:
```javascript
const TOOL_CONFIGS = {
  __proto__: null,
  ninja: {
    description: 'Ninja build system (faster alternative to Make)',
    packages: {
      darwin: { brew: 'ninja' },
      linux: { apt: 'ninja-build', yum: 'ninja-build', dnf: 'ninja-build', apk: 'ninja' },
      win32: { choco: 'ninja', scoop: 'ninja' },
    },
    binaries: {
      darwin: ['/usr/local/bin/ninja', '/opt/homebrew/bin/ninja'],
      linux: ['/usr/bin/ninja'],
      win32: ['C:\\ProgramData\\chocolatey\\bin\\ninja.exe', 'C:\\tools\\ninja\\ninja.exe'],
    },
  },
  // ... existing tools
}
```

**New Functions**:
```javascript
/**
 * Get platform-specific binary paths for a tool.
 * @param {string} tool - Tool name
 * @returns {string[]} Array of possible binary paths
 */
export function getToolBinaryPaths(tool) {
  const config = TOOL_CONFIGS[tool]
  if (!config || !config.binaries) {
    return []
  }

  const platform = process.platform
  return config.binaries[platform] || []
}

/**
 * Find installed binary path for a tool.
 * @param {string} tool - Tool name
 * @returns {string|null} Path to installed binary or null
 */
export function findToolBinary(tool) {
  // First check PATH.
  const inPath = whichBinSync(tool, { nothrow: true })
  if (inPath) {
    return inPath
  }

  // Check platform-specific paths.
  const paths = getToolBinaryPaths(tool)
  for (const path of paths) {
    try {
      if (fs.existsSync(path)) {
        return path
      }
    } catch {
      // Ignore.
    }
  }

  return null
}
```

### 2. Create build-toolchain.mjs

**Location**: `packages/build-infra/lib/build-toolchain.mjs`

**Purpose**: High-level toolchain management for workflows

```javascript
/**
 * Build Toolchain Management
 *
 * Provides high-level utilities for setting up build toolchains
 * in CI/CD workflows and local builds.
 */

import { ensureToolInstalled, findToolBinary } from './tool-installer.mjs'
import { printStep, printSubstep, printSuccess } from './build-output.mjs'

/**
 * Setup Ninja build system with caching support.
 *
 * @param {object} options - Options
 * @param {boolean} options.autoInstall - Auto-install if missing (default: true)
 * @param {boolean} options.required - Exit if not available (default: false)
 * @returns {Promise<{available: boolean, path: string|null, installed: boolean}>}
 */
export async function setupNinja({ autoInstall = true, required = false } = {}) {
  printStep('Setting up Ninja build system')

  // Check if Ninja is already installed.
  let ninjaPath = findToolBinary('ninja')
  if (ninjaPath) {
    printSubstep(`Ninja found: ${ninjaPath}`)
    return { available: true, installed: false, path: ninjaPath }
  }

  // Attempt installation.
  const result = await ensureToolInstalled('ninja', { autoInstall, autoYes: true })

  if (result.available) {
    ninjaPath = findToolBinary('ninja')
    printSuccess(`Ninja installed via ${result.packageManager}`)
    return { available: true, installed: true, path: ninjaPath }
  }

  if (required) {
    throw new Error('Ninja is required but not available')
  }

  return { available: false, installed: false, path: null }
}

/**
 * Get Ninja cache paths for GitHub Actions caching.
 *
 * @returns {{ path: string|string[], key: string }}
 */
export function getNinjaCachePaths() {
  const platform = process.platform

  const paths = {
    darwin: ['/usr/local/bin/ninja', '/opt/homebrew/bin/ninja'],
    linux: ['/usr/bin/ninja'],
    win32: ['C:\\ProgramData\\chocolatey\\bin\\ninja.exe'],
  }

  return {
    path: paths[platform] || [],
    key: `ninja-${platform}-${process.arch}`,
  }
}

/**
 * Setup Python with version check.
 *
 * @param {object} options - Options
 * @param {string} options.version - Required Python version (default: '3.11')
 * @param {boolean} options.required - Exit if not available (default: true)
 * @returns {Promise<{available: boolean, version: string|null, path: string|null}>}
 */
export async function setupPython({ version = '3.11', required = true } = {}) {
  printStep(`Setting up Python ${version}`)

  // Check Python version.
  const pythonCheck = await checkPythonVersion(version)

  if (pythonCheck.available) {
    printSubstep(`Python ${pythonCheck.version} found: ${pythonCheck.path}`)
    return {
      available: true,
      path: pythonCheck.path,
      version: pythonCheck.version,
    }
  }

  if (required) {
    throw new Error(`Python ${version}+ is required but not available`)
  }

  return { available: false, path: null, version: null }
}

/**
 * Setup complete Node.js build toolchain.
 *
 * @param {object} options - Options
 * @param {boolean} options.ninja - Setup Ninja (default: true on Linux/macOS)
 * @param {string} options.pythonVersion - Python version (default: '3.11')
 * @param {boolean} options.compiler - Check for C++ compiler (default: true)
 * @returns {Promise<object>} Toolchain setup results
 */
export async function setupNodeBuildToolchain(options = {}) {
  const platform = process.platform
  const {
    compiler = true,
    ninja = platform !== 'win32',
    pythonVersion = '3.11',
  } = options

  printStep('Setting up Node.js build toolchain')

  const results = {}

  // Python (required for Node.js builds).
  results.python = await setupPython({ version: pythonVersion, required: true })

  // Ninja (optional but recommended for Linux/macOS).
  if (ninja) {
    results.ninja = await setupNinja({ autoInstall: true, required: false })
  }

  // Compiler check.
  if (compiler) {
    const compilerCheck = await checkCompiler()
    results.compiler = compilerCheck
    if (!compilerCheck.available) {
      throw new Error('C++ compiler is required but not available')
    }
    printSubstep(`Compiler found: ${compilerCheck.name}`)
  }

  printSuccess('Node.js build toolchain ready')
  return results
}
```

### 3. Create windows-toolchain.mjs

**Location**: `packages/build-infra/lib/windows-toolchain.mjs`

**Purpose**: Windows-specific Visual Studio and MSVC setup

```javascript
/**
 * Windows Toolchain Setup
 *
 * Handles Visual Studio detection, MSVC environment configuration,
 * and Windows-specific build tooling.
 */

import { spawn } from '@socketsecurity/lib/spawn'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { printStep, printSubstep, printSuccess, printError } from './build-output.mjs'

/**
 * Find Visual Studio installation using vswhere.
 *
 * @returns {Promise<{found: boolean, path: string|null, version: string|null}>}
 */
export async function findVisualStudio() {
  if (!WIN32) {
    return { found: false, path: null, version: null }
  }

  const vswherePath = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'

  try {
    const result = await spawn(vswherePath, [
      '-products', '*',
      '-latest',
      '-prerelease',
      '-property', 'installationPath',
    ], { stdio: 'pipe' })

    if (result.code === 0 && result.stdout) {
      const vsPath = result.stdout.trim()
      return { found: true, path: vsPath, version: null }
    }
  } catch {
    // vswhere not found or failed.
  }

  return { found: false, path: null, version: null }
}

/**
 * Setup MSVC environment by running vcvarsall.bat.
 *
 * @param {object} options - Options
 * @param {string} options.arch - Target architecture (x64, arm64, etc.)
 * @param {string} options.vsPath - VS installation path (auto-detect if omitted)
 * @returns {Promise<{configured: boolean, env: object}>}
 */
export async function setupMSVCEnvironment({ arch = 'x64', vsPath = null } = {}) {
  if (!WIN32) {
    throw new Error('setupMSVCEnvironment is only supported on Windows')
  }

  printStep(`Setting up MSVC environment for ${arch}`)

  // Find VS installation.
  if (!vsPath) {
    const vs = await findVisualStudio()
    if (!vs.found) {
      throw new Error('Visual Studio installation not found')
    }
    vsPath = vs.path
  }

  printSubstep(`Visual Studio: ${vsPath}`)

  // Locate vcvarsall.bat.
  const vcvarsallPath = `${vsPath}\\VC\\Auxiliary\\Build\\vcvarsall.bat`

  // Capture environment before and after vcvarsall.bat.
  const cmdArgs = [
    '/c',
    `set && cls && "${vcvarsallPath}" ${arch} && cls && set`,
  ]

  const result = await spawn('cmd.exe', cmdArgs, { stdio: 'pipe' })

  if (result.code !== 0) {
    throw new Error('Failed to run vcvarsall.bat')
  }

  // Parse environment sections (split by form feed from cls).
  const sections = result.stdout.split('\f')
  if (sections.length < 3) {
    throw new Error('Failed to parse vcvarsall.bat output')
  }

  // Parse AFTER environment (section 2).
  const newEnv = {}
  for (const line of sections[2].split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/)
    if (match) {
      newEnv[match[1]] = match[2]
    }
  }

  // Verify critical variables were set.
  const criticalVars = ['VCINSTALLDIR', 'WindowsSDKVersion', 'INCLUDE', 'LIB', 'PATH']
  for (const varName of criticalVars) {
    if (!newEnv[varName]) {
      throw new Error(`Critical variable not set: ${varName}`)
    }
  }

  // Add gyp-specific variables.
  newEnv.GYP_MSVS_VERSION = '2022'
  newEnv.GYP_MSVS_OVERRIDE_PATH = vsPath

  printSuccess('MSVC environment configured')
  return { configured: true, env: newEnv }
}

/**
 * Get vcbuild.bat flags for Windows Node.js builds.
 *
 * @param {string[]} configureFlags - Unix-style configure flags
 * @returns {string[]} vcbuild.bat compatible flags
 */
export function convertToVcbuildFlags(configureFlags) {
  const vcbuildFlags = []

  for (const flag of configureFlags) {
    switch (flag) {
      case '--dest-cpu=arm64':
        vcbuildFlags.push('arm64')
        break
      case '--dest-cpu=x64':
        vcbuildFlags.push('x64')
        break
      case '--with-intl=small-icu':
        vcbuildFlags.push('small-icu')
        break
      case '--without-inspector':
        vcbuildFlags.push('without-inspector')
        break
      case '--without-npm':
        vcbuildFlags.push('without-npm')
        break
      case '--without-corepack':
        vcbuildFlags.push('without-corepack')
        break
      case '--ninja':
        vcbuildFlags.push('ninja')
        break
      // Ignore other flags (vcbuild.bat doesn't support them).
    }
  }

  return vcbuildFlags
}

/**
 * Ensure Git Unix tools are in PATH (for patch command).
 *
 * @returns {Promise<{available: boolean, patchPath: string|null}>}
 */
export async function ensureGitUnixTools() {
  if (!WIN32) {
    return { available: false, patchPath: null }
  }

  const gitUnixPath = 'C:\\Program Files\\Git\\usr\\bin'
  const patchPath = `${gitUnixPath}\\patch.exe`

  // Check if patch is already in PATH.
  const existingPath = whichBinSync('patch', { nothrow: true })
  if (existingPath) {
    return { available: true, patchPath: existingPath }
  }

  // Add Git Unix tools to PATH.
  process.env.PATH = `${gitUnixPath};${process.env.PATH}`

  // Verify patch is now accessible.
  const patchAvailable = whichBinSync('patch', { nothrow: true })
  if (patchAvailable) {
    printSubstep(`Added Git Unix tools to PATH: ${gitUnixPath}`)
    return { available: true, patchPath: patchAvailable }
  }

  return { available: false, patchPath: null }
}
```

### 4. Update package.json exports

**Location**: `packages/build-infra/package.json`

```json
{
  "exports": {
    "./lib/build-toolchain": "./lib/build-toolchain.mjs",
    "./lib/windows-toolchain": "./lib/windows-toolchain.mjs",
    "./lib/tool-installer": "./lib/tool-installer.mjs",
    // ... existing exports
  }
}
```

## Workflow Refactoring

### Before (Current socket-btm release.yml)

**Inline Ninja setup** (37 lines per platform):
```yaml
- name: Cache Ninja (Ubuntu)
  id: ninja-cache-ubuntu
  uses: actions/cache@v4
  with:
    path: /usr/bin/ninja
    key: ninja-ubuntu-${{ runner.os }}-${{ runner.arch }}

- name: Install Ninja (Ubuntu)
  if: steps.ninja-cache-ubuntu.outputs.cache-hit != 'true'
  run: sudo apt-get install -y ninja-build
```

**Inline Windows setup** (100+ lines):
```yaml
- name: Ensure Visual Studio is installed
  shell: pwsh
  run: |
    # 50 lines of PowerShell...

- name: Setup Visual Studio environment
  shell: pwsh
  run: |
    # 150 lines of PowerShell...
```

### After (Using build-infra)

**Simplified Ninja setup** (3 lines):
```yaml
- name: Setup build toolchain
  run: |
    node -e "
    import('@socketbin/build-infra/lib/build-toolchain').then(async m => {
      await m.setupNodeBuildToolchain({ ninja: true })
    })
    "
```

**Simplified Windows setup** (5 lines):
```yaml
- name: Setup MSVC environment (Windows)
  if: matrix.platform == 'win32'
  run: |
    node -e "
    import('@socketbin/build-infra/lib/windows-toolchain').then(async m => {
      const result = await m.setupMSVCEnvironment({ arch: '${{ matrix.arch }}' })
      // Write environment to GITHUB_ENV
      for (const [key, value] of Object.entries(result.env)) {
        console.log(\`\${key}<<EOF_\${Math.random()}\`)
        console.log(value)
        console.log(\`EOF_\${Math.random()}\`)
      }
    })
    " >> $GITHUB_ENV
```

## Alternative Approach: Shell Scripts

If Node.js-based tooling is too heavy for workflow steps, create shell scripts:

**scripts/setup-toolchain.sh**:
```bash
#!/bin/bash
# Simple shell wrapper around build-infra

node -e "
import('@socketbin/build-infra/lib/build-toolchain').then(async m => {
  await m.setupNodeBuildToolchain({ ninja: true })
})
"
```

**scripts/setup-windows.ps1**:
```powershell
# PowerShell wrapper for Windows
node -e "
import('@socketbin/build-infra/lib/windows-toolchain').then(async m => {
  const result = await m.setupMSVCEnvironment({ arch: '$env:ARCH' })
  # Export to GITHUB_ENV...
})
"
```

## Benefits

### Maintainability
- ✅ Single source of truth for toolchain setup
- ✅ Reusable across workflows (build-smol, build-wasm, build-sea)
- ✅ Testable in isolation (unit tests for build-infra)
- ✅ Consistent behavior between local and CI builds

### Readability
- ✅ Workflows focus on orchestration, not implementation
- ✅ Reduced workflow line count (940 → ~600 lines)
- ✅ Clear separation of concerns

### Extensibility
- ✅ Easy to add new tools (CMake, Rust, etc.)
- ✅ Platform-specific logic encapsulated
- ✅ Future WASM/SEA workflows can reuse toolchain setup

### Cross-Project Sharing
- ✅ socket-cli can adopt same patterns
- ✅ Shared build-infra can be published to npm
- ✅ Consistent tooling across Socket projects

## Implementation Plan

### Phase 1: Add Ninja Support (1-2 hours)
1. Update `tool-installer.mjs` with Ninja configuration
2. Add `getToolBinaryPaths()` and `findToolBinary()` functions
3. Write unit tests for Ninja detection

### Phase 2: Create build-toolchain.mjs (2-3 hours)
1. Implement `setupNinja()` function
2. Implement `setupPython()` function
3. Implement `setupNodeBuildToolchain()` orchestration
4. Add `getNinjaCachePaths()` for workflow caching

### Phase 3: Create windows-toolchain.mjs (3-4 hours)
1. Port `findVisualStudio()` from workflow
2. Port `setupMSVCEnvironment()` from workflow
3. Implement `convertToVcbuildFlags()` helper
4. Add `ensureGitUnixTools()` utility

### Phase 4: Update Workflow (1-2 hours)
1. Replace inline Ninja setup with build-toolchain calls
2. Replace inline Windows setup with windows-toolchain calls
3. Test workflow on all platforms

### Total: 7-11 hours

## Next Steps

1. **Review this proposal** - Confirm approach aligns with goals
2. **Phase 1** - Add Ninja support to tool-installer.mjs
3. **Phase 2** - Create build-toolchain.mjs
4. **Phase 3** - Create windows-toolchain.mjs (most complex)
5. **Phase 4** - Refactor workflow to use build-infra

## Questions

1. **Should build-infra be a separate published package?**
   - Pros: Reusable across projects, versioned independently
   - Cons: Adds dependency management overhead

2. **Should toolchain setup use Node.js or shell scripts?**
   - Node.js: Better for cross-platform, testable, can use @socketsecurity/lib
   - Shell: Simpler for workflows, no Node.js required in workflow steps

3. **How much Windows logic should be in build-infra?**
   - All of it (150+ lines) → Cleaner workflow
   - Just the high-level API → Workflow still has some PowerShell

## References

- socket-cli build-smol.yml: Lines 370-733 (Ninja + Windows setup)
- build-infra tool-installer.mjs: Existing tool installation framework
- Node.js vcbuild.bat documentation: https://github.com/nodejs/node/blob/main/vcbuild.bat
