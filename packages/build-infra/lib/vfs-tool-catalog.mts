/**
 * VFS tool catalog: download URLs, checksums, and platform-key helpers.
 *
 * Consumed by vfs-tools-downloader.mts to locate platform-specific
 * binaries for each supported security tool.
 */

import process from 'node:process'

/**
 * VFS tool download URLs for each platform with SHA256 checksums.
 * Windows uses official portable/embeddable distributions.
 *
 * SECURITY: All downloads MUST have SHA256 checksums for integrity
 * verification. Checksums should be obtained from official release pages or
 * computed from known-good downloads.
 */
// oxlint-disable-next-line socket/sort-object-literal-properties -- tool order matches download priority (python first, scanning tools after); reordering would split tool declarations from their changelogs
export const VFS_TOOL_URLS = {
  /**
   * Python embeddable packages (official Python.org releases)
   * Windows: embeddable zip (no installation needed)
   * Other platforms: should use system Python or pyenv
   * Checksums from: https://www.python.org/downloads/release/python-3119/
   */
  python: {
    version: '3.11.9',
    'win32-arm64': {
      url: 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-arm64.zip',
      sha256:
        '1a6dae49d15320270a7141f93b574ff7686a7a526efa65e63ddbebf9b409929a',
    },
    'win32-x64': {
      url: 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip',
      sha256:
        '009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b',
    },
  },

  /**
   * Trivy vulnerability scanner (Aqua Security)
   * GitHub releases provide pre-built binaries for all platforms
   * Checksums from: https://github.com/aquasecurity/trivy/releases/tag/v0.50.4.
   */
  trivy: {
    version: '0.69.3',
    'win32-x64': {
      sha256:
        '74362dc711383255308230ecbeb587eb1e4e83a8d332be5b0259afac6e0c2224',
      url: 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_windows-64bit.zip',
    },
    // Not available in this release
    'win32-arm64': undefined,
    'darwin-x64': {
      sha256:
        'fec4a9f7569b624dd9d044fca019e5da69e032700edbb1d7318972c448ec2f4e',
      url: 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_macOS-64bit.tar.gz',
    },
    'darwin-arm64': {
      sha256:
        'a2f2179afd4f8bb265ca3c7aefb56a666bc4a9a411663bc0f22c3549fbc643a5',
      url: 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_macOS-ARM64.tar.gz',
    },
    'linux-x64': {
      sha256:
        '1816b632dfe529869c740c0913e36bd1629cb7688bd5634f4a858c1d57c88b75',
      url: 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_Linux-64bit.tar.gz',
    },
    'linux-arm64': {
      sha256:
        '7e3924a974e912e57b4a99f65ece7931f8079584dae12eb7845024f97087bdfd',
      url: 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_Linux-ARM64.tar.gz',
    },
  },

  /**
   * TruffleHog secrets scanner (Truffle Security) GitHub releases provide
   * pre-built binaries for all platforms Checksums from:
   * https://github.com/trufflesecurity/trufflehog/releases/tag/v3.78.1.
   */
  trufflehog: {
    'darwin-arm64': {
      url: 'https://github.com/trufflesecurity/trufflehog/releases/download/v3.93.7/trufflehog_3.93.7_darwin_arm64.tar.gz',
      sha256:
        '1f742b04c0c08fa9e199c3b6ca9e4ccfd639f439689673ad52add698d266c9ff',
    },
    'darwin-x64': {
      url: 'https://github.com/trufflesecurity/trufflehog/releases/download/v3.93.7/trufflehog_3.93.7_darwin_amd64.tar.gz',
      sha256:
        '064fd3bcab3a4e480a4bdb988a8b8338f3aa1f91ebd4ef3484416e0b7b2c3255',
    },
    'linux-arm64': {
      url: 'https://github.com/trufflesecurity/trufflehog/releases/download/v3.93.7/trufflehog_3.93.7_linux_arm64.tar.gz',
      sha256:
        '8a0fba600d564912e3d7450766847e4ce0d7cda08edd44c346eb899c71ace067',
    },
    'linux-x64': {
      url: 'https://github.com/trufflesecurity/trufflehog/releases/download/v3.93.7/trufflehog_3.93.7_linux_amd64.tar.gz',
      sha256:
        'a87e178a2643238e31bee50261b681e29f0d502c00deb10055bd7570413e0a87',
    },
    version: '3.93.7',
    'win32-arm64': {
      url: 'https://github.com/trufflesecurity/trufflehog/releases/download/v3.93.7/trufflehog_3.93.7_windows_arm64.tar.gz',
      sha256:
        '72cbc127092f71f463aa0c1f6efcdc81c9cd8935221d92548d21335b02117874',
    },
    'win32-x64': {
      url: 'https://github.com/trufflesecurity/trufflehog/releases/download/v3.93.7/trufflehog_3.93.7_windows_amd64.tar.gz',
      sha256:
        '4f86826ce52230fca38eaac12c18e5572d404f017215a62d0784e800fcf05365',
    },
  },

  /**
   * OpenGrep code scanner (Semgrep fork)
   * Note: OpenGrep releases may have different naming - verify URLs
   * Checksums from: https://github.com/opengrep/opengrep/releases/tag/v1.64.0.
   */
  opengrep: {
    'darwin-arm64': {
      url: 'https://github.com/opengrep/opengrep/releases/download/v1.16.3/opengrep-core_osx_aarch64.tar.gz',
      sha256:
        'ba78a28fd035ddb8bf6a89c91c3b66589abe94716140def4369a32ff57dd7d2f',
    },
    'darwin-x64': {
      url: 'https://github.com/opengrep/opengrep/releases/download/v1.16.3/opengrep-core_osx_x86.tar.gz',
      sha256:
        'c96d9238e352d2516544f9c213b9d0fc27448899da55489664048abd132b1c5e',
    },
    'linux-arm64': {
      url: 'https://github.com/opengrep/opengrep/releases/download/v1.16.3/opengrep-core_linux_aarch64.tar.gz',
      sha256:
        '5d3d52ff86ab231e43503e0e1aca76085f95c2ff4b03755a6816a13ee7e4f125',
    },
    'linux-x64': {
      url: 'https://github.com/opengrep/opengrep/releases/download/v1.16.3/opengrep-core_linux_x86.tar.gz',
      sha256:
        '2b97cda3b4a6794c04aad58932d3a8df07bc43e11afbb0bfb869bb0c7c95e41e',
    },
    version: '1.16.3',
    'win32-x64': {
      url: 'https://github.com/opengrep/opengrep/releases/download/v1.16.3/opengrep-core_windows_x86.zip',
      sha256:
        '9b3031b0e40725a4a976491fd968a4f9a6f6f964a5b6eadb0b704478b6bc3c22',
    },
  },
}

/**
 * Get available tools for a platform.
 *
 * @param {string} [platform] - Platform (darwin, linux, win32)
 * @param {string} [arch] - Architecture (x64, arm64)
 *
 * @returns {string[]} Array of tool names available for this platform
 */
export function getAvailableTools(
  platform = process.platform,
  arch = process.arch,
) {
  const key = getPlatformKey(platform, arch)
  const tools = []

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [toolName, config] of Object.entries(VFS_TOOL_URLS)) {
    if (config[key]) {
      tools.push(toolName)
    }
  }

  return tools
}

/**
 * Get platform key for VFS tool URLs.
 *
 * @param {string} [platform] - Platform (darwin, linux, win32)
 * @param {string} [arch] - Architecture (x64, arm64)
 *
 * @returns {string} Platform-arch key (e.g., "win32-x64")
 */
export function getPlatformKey(
  platform = process.platform,
  arch = process.arch,
) {
  return `${platform}-${arch}`
}
