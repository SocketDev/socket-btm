/**
 * @file Small, dependency-free checks shared by native release workflows.
 *   Reading the binary header catches the dangerous case where an asset name
 *   says one platform or CPU but contains another.
 */

export interface TargetSpec {
  format: 'elf' | 'mach-o' | 'pe'
  machine: number
}

const TARGETS = new Map<string, TargetSpec>([
  ['darwin-arm64', { format: 'mach-o', machine: 0x01_00_00_0c }],
  ['darwin-x64', { format: 'mach-o', machine: 0x01_00_00_07 }],
  ['linux-arm64', { format: 'elf', machine: 183 }],
  ['linux-x64', { format: 'elf', machine: 62 }],
  ['win32-x64', { format: 'pe', machine: 0x86_64 }],
] as const)

export function validateNativeBinary(
  bytes: Buffer,
  target: string,
  label: string,
): void {
  const spec = TARGETS.get(target)
  if (!spec) {
    throw new Error(`Unsupported ${label} target: ${target}`)
  }
  if (bytes.length < 1000) {
    throw new Error(`${label} is too small: ${bytes.length} bytes`)
  }

  let format: 'elf' | 'mach-o' | 'pe'
  let machine: number
  if (bytes[0] === 0x7f && bytes.subarray(1, 4).toString('ascii') === 'ELF') {
    format = 'elf'
    machine = bytes.readUInt16LE(18)
  } else if (bytes.readUInt32LE(0) === 0xfe_ed_fa_cf) {
    format = 'mach-o'
    machine = bytes.readUInt32LE(4)
  } else if (bytes.subarray(0, 2).toString('ascii') === 'MZ') {
    format = 'pe'
    const peOffset = bytes.readUInt32LE(0x3c)
    if (
      peOffset + 6 > bytes.length ||
      bytes.readUInt32LE(peOffset) !== 0x00_00_45_50
    ) {
      throw new Error(`${label} has an invalid PE header`)
    }
    machine = bytes.readUInt16LE(peOffset + 4)
  } else {
    throw new Error(`${label} is not a supported Mach-O, ELF, or PE binary`)
  }

  if (format !== spec.format || machine !== spec.machine) {
    throw new Error(
      `${label} target mismatch: expected ${spec.format}/${spec.machine}, got ${format}/${machine}`,
    )
  }
}

export function validateNativeTarget(target: string, label: string): void {
  if (!TARGETS.has(target)) {
    throw new Error(`Unsupported ${label} target: ${target}`)
  }
}

export function validatePlainVersion(version: string): void {
  // Three dot-separated, non-negative decimal components. Each component is
  // either zero or starts with 1-9, which rejects ambiguous leading zeros.
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(version)) {
    throw new Error(
      `Version must be plain semantic version X.Y.Z, got: ${version}`,
    )
  }
}
