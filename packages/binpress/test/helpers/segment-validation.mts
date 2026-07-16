/**
 * @file Command-exec and Mach-O segment-parsing helpers for
 *   segment-validation.test.mts. Split out to keep the describe/test
 *   scenarios under the file-size soft cap.
 */

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'

export interface ExecCommandResult {
  code: number | null
  stderr: string
  stdout: string
}

export interface MachoSection {
  sectionName: string
}

export interface MachoSegment {
  sections: MachoSection[]
  segmentName: string
}

export async function execCommand(
  command: string,
  args: string[] | readonly string[] = [],
  options: SpawnOptions = {},
): Promise<ExecCommandResult> {
  return new Promise<ExecCommandResult>(resolve => {
    const spawnPromise = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // @socketsecurity/lib-stable/process/spawn/child returns a Promise with .process property
    const proc = spawnPromise.process

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      resolve({ code, stderr, stdout })
    })

    // Handle spawn Promise rejection (non-zero exit codes)
    spawnPromise.catch(() => {
      // Already handled by 'close' event
    })
  })
}

/**
 * Parse Mach-O segments from binary data.
 */
export function parseMachoSegments(
  binaryData: Buffer,
): MachoSegment[] | undefined {
  const segments: MachoSegment[] = []

  // Mach-O magic numbers
  const MH_MAGIC_64 = 0xfe_ed_fa_cf
  const MH_CIGAM_64 = 0xcf_fa_ed_fe

  const magic = binaryData.readUInt32LE(0)
  const isLittleEndian = magic === MH_MAGIC_64

  if (!isLittleEndian && magic !== MH_CIGAM_64) {
    // Not Mach-O
    return undefined
  }

  const ncmds = isLittleEndian
    ? binaryData.readUInt32LE(16)
    : binaryData.readUInt32BE(16)

  // sizeof(mach_header_64)
  let offset = 32

  for (let i = 0; i < ncmds; i++) {
    const cmd = isLittleEndian
      ? binaryData.readUInt32LE(offset)
      : binaryData.readUInt32BE(offset)
    const cmdsize = isLittleEndian
      ? binaryData.readUInt32LE(offset + 4)
      : binaryData.readUInt32BE(offset + 4)

    // LC_SEGMENT_64 = 0x19
    if (cmd === 0x19) {
      const segmentName = binaryData
        .subarray(offset + 8, offset + 24)
        .toString('utf8')
        .replace(/\0.*$/, '')

      const nsects = isLittleEndian
        ? binaryData.readUInt32LE(offset + 64)
        : binaryData.readUInt32BE(offset + 64)

      const sections: MachoSection[] = []
      // sizeof(segment_command_64)
      let sectionOffset = offset + 72

      for (let j = 0; j < nsects; j++) {
        const sectionName = binaryData
          .subarray(sectionOffset, sectionOffset + 16)
          .toString('utf8')
          .replace(/\0.*$/, '')

        sections.push({ sectionName })
        // sizeof(section_64)
        sectionOffset += 80
      }

      segments.push({ sections, segmentName })
    }

    offset += cmdsize
  }

  return segments
}
