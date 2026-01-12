/**
 * Shared utility for packages with simple checkpoint chains.
 *
 * For packages that only have a 'finalized' checkpoint (no complex build stages).
 * Used by: binject, binflate, binpress, bin-infra
 *
 * @param {object} options - Options
 * @param {string[]} options.chain - Checkpoint chain array (default: ['finalized'])
 * @returns {string} Comma-separated checkpoint chain for CI
 */
export function getSimpleCheckpointChain({ chain = ['finalized'] } = {}) {
  return chain.join(',')
}
