/**
 * Static analysis of unified-diff patch content.
 *
 * Pure helpers that read patch text: classify which subsystems a patch touches,
 * parse hunk headers into modified line ranges, and detect overlapping edits
 * between patches. No filesystem or `patch`-binary interaction lives here.
 */

/**
 * An inclusive modified-line range parsed from a unified-diff hunk header.
 */
export interface PatchLineRange {
  end: number
  start: number
}

/**
 * A conflict (or warning) between patches in a directory.
 */
export interface PatchConflict {
  message: string
  severity: 'error' | 'warning'
}

/**
 * Loaded patch data checkPatchConflicts inspects.
 */
export interface PatchFileData {
  content?: string | undefined
  name: string
}

/**
 * Analyze patch file content for specific modifications.
 *
 * @param {string} content - Patch file content.
 *
 * @returns {object} Analysis result
 */
export function analyzePatchContent(content: string): {
  modifiesBrotli: boolean
  modifiesSEA: boolean
  modifiesV8Includes: boolean
} {
  return {
    modifiesBrotli: content.includes('brotli') || content.includes('Brotli'),
    modifiesSEA: content.includes('SEA') || content.includes('sea_'),
    modifiesV8Includes: content.includes('v8.h') || content.includes('v8-'),
  }
}

/**
 * Check for conflicts between patches.
 *
 * @param {Array} patchData - Array of patch data objects with {name, path,
 *   content, analysis}
 *
 * @returns {Array} Array of conflict objects with {severity, message}
 */
export function checkPatchConflicts(
  patchData: PatchFileData[],
): PatchConflict[] {
  const conflicts: PatchConflict[] = []

  // Map each patch to its file modifications
  const patchModifications: Array<{
    modifications: Map<string, PatchLineRange[]>
    name: string
  }> = []

  for (let i = 0, { length } = patchData; i < length; i += 1) {
    const patch = patchData[i]
    if (patch === undefined) {
      continue
    }
    if (!patch.content) {
      conflicts.push({
        message: `Patch ${patch.name} missing content`,
        severity: 'warning',
      })
      continue
    }

    const modifications = parsePatchFileModifications(patch.content)
    patchModifications.push({
      modifications,
      name: patch.name,
    })
  }

  // Check for overlapping modifications between patches
  for (let i = 0; i < patchModifications.length; i++) {
    for (let j = i + 1; j < patchModifications.length; j++) {
      const patch1 = patchModifications[i]
      const patch2 = patchModifications[j]
      if (!patch1 || !patch2) {
        continue
      }

      // Find files modified by both patches
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
      for (const [file, ranges1] of patch1.modifications.entries()) {
        const ranges2 = patch2.modifications.get(file)
        if (ranges2) {
          // Check if any line ranges overlap
          for (
            let r1 = 0, { length: length1 } = ranges1;
            r1 < length1;
            r1 += 1
          ) {
            const range1 = ranges1[r1]
            if (range1 === undefined) {
              continue
            }
            for (
              let r2 = 0, { length: length2 } = ranges2;
              r2 < length2;
              r2 += 1
            ) {
              const range2 = ranges2[r2]
              if (range2 !== undefined && rangesOverlap(range1, range2)) {
                conflicts.push({
                  message: `Patches '${patch1.name}' and '${patch2.name}' both modify ${file} at overlapping lines (${range1.start}-${range1.end} vs ${range2.start}-${range2.end})`,
                  severity: 'error',
                })
              }
            }
          }
        }
      }
    }
  }

  return conflicts
}

/**
 * Parse a patch file to extract file modifications and line ranges.
 *
 * @param {string} content - Patch file content.
 *
 * @returns {Map<string, { start: number; end: number }[]>} Map of file paths to
 *   modified line ranges.
 */
export function parsePatchFileModifications(
  content: string,
): Map<string, PatchLineRange[]> {
  const fileModifications = new Map<string, PatchLineRange[]>()
  const lines = content.split('\n')

  let currentFile: string | undefined
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line === undefined) {
      i++
      continue
    }

    // Parse unified diff file header: "--- a/path/to/file.js"
    if (line.startsWith('--- a/')) {
      currentFile = line.slice(6).trim()
      i++
      continue
    }

    // Parse hunk header: "@@ -10,5 +10,6 @@" (old start, old count, new start, new count)
    if (line.startsWith('@@') && currentFile) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (match) {
        const newStart = Number.parseInt(match[3] ?? '', 10)
        const newCount = match[4] ? Number.parseInt(match[4], 10) : 1

        // Skip malformed hunks with invalid line numbers
        if (Number.isNaN(newStart) || Number.isNaN(newCount)) {
          i++
          continue
        }

        let ranges = fileModifications.get(currentFile)
        if (!ranges) {
          ranges = []
          fileModifications.set(currentFile, ranges)
        }

        // Handle deletion-only hunks (newCount = 0) to avoid invalid ranges where end < start
        // Deletion hunks have newCount=0, resulting in range [start, start] which represents
        // the line position where content was deleted
        const end = newCount === 0 ? newStart : newStart + newCount - 1
        ranges.push({ end, start: newStart })
      }
    }

    i++
  }

  return fileModifications
}

/**
 * Check if two line ranges overlap.
 *
 * @param {object} range1 - First range {start, end}
 * @param {object} range2 - Second range {start, end}
 *
 * @returns {boolean}
 */
export function rangesOverlap(
  range1: PatchLineRange,
  range2: PatchLineRange,
): boolean {
  return range1.start <= range2.end && range2.start <= range1.end
}
