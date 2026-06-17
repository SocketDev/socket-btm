/**
 * Required-files manifest for a Dawn install — source of truth
 * shared by scripts/build.mts (drives checkpoint validation) and
 * scripts/verify-release.mts (runs in CI before archiving). Kept in
 * its own file with zero imports so verify-release can stay
 * standalone and avoid workspace-resolution failures on runners
 * where the `build-infra` symlink is missing.
 *
 * Each entry is a path relative to the install/extract dir. Dawn's
 * CMake island-build produces:
 *
 *   lib/libwebgpu_dawn.a        — static library node-smol links
 *   include/dawn/webgpu.h       — WebGPU C-API header
 *   include/dawn/webgpu_cpp.h   — WebGPU C++-API header
 *
 * Only the static lib is universally required for the v0 link path;
 * the headers are needed for full Dawn-backed bindings (D7+).
 */
export const DAWN_REQUIRED_FILES = [
  'lib/libwebgpu_dawn.a',
  'include/dawn/webgpu.h',
  'include/dawn/webgpu_cpp.h',
]
