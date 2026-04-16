import process from 'node:process'

/**
 * CI Disk Cleanup Paths
 *
 * Defines paths to clean up on CI runners to free disk space.
 * These paths contain pre-installed tools that are not needed for our builds.
 *
 * Organized by platform with descriptions and approximate sizes.
 */

/**
 * @typedef {Object} CleanupTask
 * @property {string} path - Absolute path to remove
 * @property {string} desc - Human-readable description with size estimate
 */

/**
 * Linux CI runner cleanup paths (~10GB total).
 * @type {CleanupTask[]}
 */
export const LINUX_CLEANUP_PATHS = [
  { desc: '.NET SDK (~3GB)', path: '/usr/share/dotnet' },
  { desc: 'Android SDK (~4GB)', path: '/usr/local/lib/android' },
  { desc: 'Haskell GHC (~1GB)', path: '/opt/ghc' },
  { desc: 'CodeQL (~2GB)', path: '/opt/hostedtoolcache/CodeQL' },
  { desc: 'Boost (~1GB)', path: '/usr/local/share/boost' },
]

/**
 * macOS CI runner cleanup paths (~20GB total).
 * Note: HOME-relative paths are resolved at runtime.
 * @type {CleanupTask[]}
 */
export const MACOS_CLEANUP_PATHS = [
  // HOME-relative path handled separately in cleanup function
  { desc: '.NET SDK (~2GB)', path: '/usr/local/share/dotnet' },
  {
    desc: 'iOS Simulators (~5GB)',
    path: '/Library/Developer/CoreSimulator/Profiles/Runtimes',
  },
  { desc: 'Boost (~1GB)', path: '/usr/local/share/boost' },
  { desc: 'CodeQL (~2GB)', path: '/opt/hostedtoolcache/CodeQL' },
]

/**
 * macOS Android SDK path (HOME-relative).
 * Resolved at runtime with user's HOME directory.
 */
export const MACOS_ANDROID_SDK_SUBPATH = 'Library/Android/sdk'

/**
 * Windows CI runner cleanup paths (~15GB total).
 * @type {CleanupTask[]}
 */
export const WINDOWS_CLEANUP_PATHS = [
  { desc: 'Android SDK (~10GB)', path: 'C:\\Android' },
  { desc: '.NET SDK (~2GB)', path: 'C:\\Program Files\\dotnet' },
  { desc: 'CodeQL (~2GB)', path: 'C:\\hostedtoolcache\\windows\\CodeQL' },
  { desc: 'Chocolatey cache (~1GB)', path: 'C:\\ProgramData\\chocolatey' },
]

/**
 * Get cleanup paths for the specified platform.
 * @param {'linux' | 'darwin' | 'win32'} platform - Target platform
 * @param {string} [homeDir] - Home directory for macOS (defaults to process.env.HOME)
 * @returns {CleanupTask[]} Array of cleanup tasks
 */
export function getCleanupPaths(platform, homeDir) {
  switch (platform) {
    case 'linux': {
      return LINUX_CLEANUP_PATHS
    }

    case 'darwin': {
      const home = homeDir || process.env.HOME || '/Users/runner'
      return [
        {
          desc: 'Android SDK (~10GB)',
          path: `${home}/${MACOS_ANDROID_SDK_SUBPATH}`,
        },
        ...MACOS_CLEANUP_PATHS,
      ]
    }

    case 'win32': {
      return WINDOWS_CLEANUP_PATHS
    }

    default: {
      return []
    }
  }
}
