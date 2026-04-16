import { CHECKPOINT_CHAINS } from './constants.mts'

/**
 * Get simple checkpoint chain for packages with single-stage builds.
 *
 * Used by binsuite packages (binpress, binflate, binject) that have
 * a simple build flow with a single "finalized" checkpoint.
 *
 * @returns {string[]} Checkpoint chain array
 */
export function getSimpleCheckpointChain() {
  return CHECKPOINT_CHAINS.simple()
}
