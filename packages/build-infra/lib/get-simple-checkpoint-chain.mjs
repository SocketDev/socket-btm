/**
 * Get simple checkpoint chain for packages with single-stage builds.
 *
 * Used by binsuite packages (binpress, binflate, binject) that have
 * a simple build flow with a single "finalized" checkpoint.
 *
 * @returns {string} Comma-separated checkpoint chain
 */
export function getSimpleCheckpointChain() {
  // Simple packages just have one checkpoint: finalized
  // This is used by CI to know which checkpoints to look for
  return 'finalized'
}
