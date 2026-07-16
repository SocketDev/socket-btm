/**
 * Tool installer platform configs and package-manager detection.
 *
 * Houses PACKAGE_MANAGER_CONFIGS, KEG_ONLY_FORMULAS, and the detection /
 * lookup helpers. Split from tool-installer.mts to keep each file under the
 * 500-line soft cap.
 */

import binPkg from '@socketsecurity/lib-stable/bin/which'

import { getPlatform } from './build-env.mts'
import { getToolConfig } from './pinned-versions.mts'

const { whichSync } = binPkg

/**
 * Homebrew "keg-only" formulas — brew installs them without symlinking
 * into /opt/homebrew/lib because they conflict with macOS-shipped
 * versions. That breaks tools that try to dlopen them at runtime
 * (e.g. cargo expecting libssl.3.dylib from openssl@3). After
 * `brew install <name>`, force-link with `brew link --overwrite --force`
 * so dependent binaries can find the dylibs.
 *
 * Add a formula here only when:
 *
 * 1. Brew lists it as keg-only (`brew info <name>` shows the warning),
 * 2. A tool we install (rust/cargo, postgres clients, etc.) needs to dlopen its
 *    dylib at runtime — without the link, the dependent binary errors out with
 *    "Library not loaded: libfoo.dylib".
 */
export const KEG_ONLY_FORMULAS: ReadonlySet<string> = new Set(['openssl@3'])

/**
 * Package manager configuration per platform.
 */
export const PACKAGE_MANAGER_CONFIGS = {
  __proto__: null,
  darwin: {
    available: ['brew'],
    brew: {
      name: 'Homebrew',
      binary: 'brew',
      installScript:
        '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      checkCommand: 'brew --version',
      description: 'macOS package manager',
    },
    preferred: 'brew',
  },
  linux: {
    apk: {
      name: 'APK',
      binary: 'apk',
      // Pre-installed on Alpine Linux.
      installScript: undefined,
      checkCommand: 'apk --version',
      description: 'Alpine Linux package manager',
    },
    apt: {
      name: 'APT',
      binary: 'apt-get',
      // Pre-installed on Debian/Ubuntu.
      installScript: undefined,
      checkCommand: 'apt-get --version',
      description: 'Debian/Ubuntu package manager',
    },
    available: ['apt', 'apk', 'dnf', 'yum'],
    dnf: {
      name: 'DNF',
      binary: 'dnf',
      // Pre-installed on Fedora 22+/RHEL 8+.
      installScript: undefined,
      checkCommand: 'dnf --version',
      description: 'Fedora/RHEL 8+ package manager',
    },
    preferred: 'apt',
    yum: {
      name: 'YUM',
      binary: 'yum',
      // Pre-installed on older RHEL/CentOS.
      installScript: undefined,
      checkCommand: 'yum --version',
      description: 'RHEL/CentOS package manager',
    },
  },
  win32: {
    available: ['choco', 'scoop'],
    choco: {
      name: 'Chocolatey',
      binary: 'choco',
      installScript:
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((New-Object System.Net.WebClient).DownloadString(\'https://chocolatey.org/install.ps1\'))"',
      checkCommand: 'choco --version',
      description: 'Windows package manager',
    },
    preferred: 'choco',
    scoop: {
      name: 'Scoop',
      binary: 'scoop',
      installScript:
        'powershell -Command "iex (new-object net.webclient).downloadstring(\'https://get.scoop.sh\')"',
      checkCommand: 'scoop --version',
      description: 'Windows command-line installer',
    },
  },
}

/**
 * Detect available package managers on the system.
 *
 * @returns {string[]} Array of available package manager names.
 */
export function detectPackageManagers() {
  const platform = getPlatform()
  const config = PACKAGE_MANAGER_CONFIGS[platform]

  if (!config) {
    return []
  }

  const managers = []

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const managerName of config.available) {
    const managerConfig = config[managerName]
    if (whichSync(managerConfig.binary, { nothrow: true })) {
      managers.push(managerName)
    }
  }

  return managers
}

/**
 * Get installation instructions for a tool.
 *
 * @param {string} tool - Tool name.
 *
 * @returns {string[]} Array of installation instruction strings.
 */
// oxlint-disable-next-line socket/sort-source-methods -- ordered by detection → lookup → instructions pipeline; alphabetizing across phases would scatter the flow.
export function getInstallInstructions(tool) {
  const config = getToolConfig(tool)
  if (!config) {
    return [`Unknown tool: ${tool}`]
  }

  const platform = getPlatform()
  const instructions = []

  instructions.push(`Install ${tool} (${config.description}):`)

  if (platform === 'darwin') {
    instructions.push(`  brew install ${tool}`)
  } else if (platform === 'linux') {
    instructions.push(`  sudo apt-get install -y ${tool}`)
  } else if (platform === 'win32') {
    instructions.push(`  choco install ${tool}`)
  } else {
    instructions.push(`  Install ${tool} using your system package manager`)
  }

  return instructions
}

/**
 * Get package manager installation instructions.
 *
 * @returns {string[]} Array of installation instruction strings.
 */
// oxlint-disable-next-line socket/sort-source-methods -- ordered by detection → lookup → instructions pipeline; alphabetizing across phases would scatter the flow.
export function getPackageManagerInstructions() {
  const platform = getPlatform()
  const config = PACKAGE_MANAGER_CONFIGS[platform]

  if (!config) {
    return ['Unsupported platform for package manager auto-installation']
  }

  const instructions = []
  const preferred = config[config.preferred]

  instructions.push(`Install ${preferred.name} (${preferred.description}):`)
  if (preferred.installScript) {
    instructions.push(`  ${preferred.installScript}`)
  } else {
    instructions.push('  (Pre-installed on this system)')
  }

  return instructions
}

/**
 * Get preferred package manager for current platform.
 *
 * @returns {string | undefined} Preferred package manager name or undefined.
 */
// oxlint-disable-next-line socket/sort-source-methods -- ordered by detection → lookup → instructions pipeline; alphabetizing across phases would scatter the flow.
export function getPreferredPackageManager() {
  const platform = getPlatform()
  const config = PACKAGE_MANAGER_CONFIGS[platform]

  return config ? config.preferred : undefined
}
