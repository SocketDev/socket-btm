/**
 * Paths used by common scripts.
 *
 * Re-exports infrastructure paths from root that are actually used by common scripts.
 */

export {
  PACKAGE_ROOT,
  MONOREPO_ROOT,
  SUBMODULE_PATH,
  getBuildPaths,
  getSharedBuildPaths,
  getBuildSourcePaths,
  getExistingPaths,
} from '../../paths.mjs'
