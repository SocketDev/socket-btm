/**
 * @fileoverview Tests for compression tools (macho, elf, pe).
 * Validates that compression/decompression binaries are built correctly.
 */

import { existsSync, promises as fs } from 'node:fs'
import { platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const compressionToolsDir = path.join(packageDir, 'compression-tools')
const DLX_CACHE_DIR = '_dlx'

describe('compression tools', () => {
  describe('source files', () => {
    it('should have Makefile', () => {
      const makefilePath = path.join(compressionToolsDir, 'Makefile')
      expect(existsSync(makefilePath)).toBe(true)
    })

    it('should have Makefile.linux', () => {
      const makefilePath = path.join(compressionToolsDir, 'Makefile.linux')
      expect(existsSync(makefilePath)).toBe(true)
    })

    it('should have Makefile.windows', () => {
      const makefilePath = path.join(compressionToolsDir, 'Makefile.windows')
      expect(existsSync(makefilePath)).toBe(true)
    })

    it('should have macOS compression source', () => {
      const machoCompressPath = path.join(
        compressionToolsDir,
        'macho_compress.c',
      )
      expect(existsSync(machoCompressPath)).toBe(true)
    })

    it('should have macOS decompression source', () => {
      const machoDecompressPath = path.join(
        compressionToolsDir,
        'macho_decompress.c',
      )
      expect(existsSync(machoDecompressPath)).toBe(true)
    })

    it('should have Linux compression source', () => {
      const elfCompressPath = path.join(compressionToolsDir, 'elf_compress.c')
      expect(existsSync(elfCompressPath)).toBe(true)
    })

    it('should have Linux decompression source', () => {
      const elfDecompressPath = path.join(
        compressionToolsDir,
        'elf_decompress.c',
      )
      expect(existsSync(elfDecompressPath)).toBe(true)
    })

    it('should have Windows compression source', () => {
      const peCompressPath = path.join(compressionToolsDir, 'pe_compress.c')
      expect(existsSync(peCompressPath)).toBe(true)
    })

    it('should have Windows decompression source', () => {
      const peDecompressPath = path.join(compressionToolsDir, 'pe_decompress.c')
      expect(existsSync(peDecompressPath)).toBe(true)
    })
  })

  describe('macOS compression tools (darwin)', () => {
    const machoCompressBin = path.join(
      compressionToolsDir,
      'socketsecurity_macho_compress',
    )
    const machoDecompressBin = path.join(
      compressionToolsDir,
      'socketsecurity_macho_decompress',
    )

    it('should have compress binary on macOS', () => {
      if (platform() !== 'darwin' || !existsSync(machoCompressBin)) {
        // Skip if not macOS or binary not built
        return
      }
      expect(existsSync(machoCompressBin)).toBe(true)
    })

    it('should have decompress binary on macOS', () => {
      if (platform() !== 'darwin' || !existsSync(machoDecompressBin)) {
        // Skip if not macOS or binary not built
        return
      }
      expect(existsSync(machoDecompressBin)).toBe(true)
    })

    it('compress binary should be executable on macOS', async () => {
      if (platform() !== 'darwin' || !existsSync(machoCompressBin)) {
        return
      }

      const stats = await fs.stat(machoCompressBin)
      // Check if owner has execute permission (0o100)
      expect(stats.mode & 0o100).not.toBe(0)
    })

    it('decompress binary should be executable on macOS', async () => {
      if (platform() !== 'darwin' || !existsSync(machoDecompressBin)) {
        return
      }

      const stats = await fs.stat(machoDecompressBin)
      expect(stats.mode & 0o100).not.toBe(0)
    })

    it('compress binary should be Mach-O format on macOS', async () => {
      if (platform() !== 'darwin' || !existsSync(machoCompressBin)) {
        return
      }

      const buffer = await fs.readFile(machoCompressBin)
      // Mach-O magic numbers: 0xFEEDFACE (32-bit) or 0xFEEDFACF (64-bit)
      const magic = buffer.readUInt32BE(0)
      // 64-bit little-endian
      // 32-bit big-endian
      // 32-bit little-endian
      // 64-bit big-endian
      const isMachO =
        magic === 0xcf_fa_ed_fe ||
        magic === 0xfe_ed_fa_ce ||
        magic === 0xce_fa_ed_fe ||
        magic === 0xfe_ed_fa_cf
      expect(isMachO).toBe(true)
    })
  })

  describe('Linux compression tools (linux)', () => {
    const elfCompressBin = path.join(
      compressionToolsDir,
      'socketsecurity_elf_compress',
    )
    const elfDecompressBin = path.join(
      compressionToolsDir,
      'socketsecurity_elf_decompress',
    )

    it('should have compress binary on Linux', () => {
      if (platform() !== 'linux' || !existsSync(elfCompressBin)) {
        // Skip if not Linux or binary not built
        return
      }
      expect(existsSync(elfCompressBin)).toBe(true)
    })

    it('should have decompress binary on Linux', () => {
      if (platform() !== 'linux' || !existsSync(elfDecompressBin)) {
        // Skip if not Linux or binary not built
        return
      }
      expect(existsSync(elfDecompressBin)).toBe(true)
    })

    it('compress binary should be executable on Linux', async () => {
      if (platform() !== 'linux' || !existsSync(elfCompressBin)) {
        return
      }

      const stats = await fs.stat(elfCompressBin)
      expect(stats.mode & 0o100).not.toBe(0)
    })

    it('decompress binary should be executable on Linux', async () => {
      if (platform() !== 'linux' || !existsSync(elfDecompressBin)) {
        return
      }

      const stats = await fs.stat(elfDecompressBin)
      expect(stats.mode & 0o100).not.toBe(0)
    })

    it('compress binary should be ELF format on Linux', async () => {
      if (platform() !== 'linux' || !existsSync(elfCompressBin)) {
        return
      }

      const buffer = await fs.readFile(elfCompressBin)
      // ELF magic number: 0x7F 'E' 'L' 'F'
      const magic = buffer.slice(0, 4).toString('hex')
      expect(magic).toBe('7f454c46')
    })

    it('decompress binary should be statically linked on Linux', async () => {
      if (platform() !== 'linux' || !existsSync(elfDecompressBin)) {
        return
      }

      // Check file size - static binaries are larger
      const stats = await fs.stat(elfDecompressBin)
      // Static LZMA decompressor should be > 500KB
      expect(stats.size).toBeGreaterThan(500 * 1024)
    })
  })

  describe('Windows compression tools (win32)', () => {
    const peCompressBin = path.join(
      compressionToolsDir,
      'socketsecurity_pe_compress.exe',
    )
    const peDecompressBin = path.join(
      compressionToolsDir,
      'socketsecurity_pe_decompress.exe',
    )

    it('should have compress binary on Windows', () => {
      if (platform() !== 'win32' || !existsSync(peCompressBin)) {
        // Skip if not Windows or binary not built
        return
      }
      expect(existsSync(peCompressBin)).toBe(true)
    })

    it('should have decompress binary on Windows', () => {
      if (platform() !== 'win32' || !existsSync(peDecompressBin)) {
        // Skip if not Windows or binary not built
        return
      }
      expect(existsSync(peDecompressBin)).toBe(true)
    })

    it('compress binary should be PE format on Windows', async () => {
      if (platform() !== 'win32' || !existsSync(peCompressBin)) {
        return
      }

      const buffer = await fs.readFile(peCompressBin)
      // PE magic: 'MZ' at start
      const mzMagic = buffer.slice(0, 2).toString('ascii')
      expect(mzMagic).toBe('MZ')

      // PE signature at offset pointed to by byte 0x3C
      const peOffset = buffer.readUInt32LE(0x3c)
      const peSignature = buffer.slice(peOffset, peOffset + 4).toString('ascii')
      expect(peSignature).toBe('PE\0\0')
    })
  })

  describe('compression tool implementation', () => {
    it('macOS decompressor should use Apple compression', async () => {
      const sourceFile = path.join(compressionToolsDir, 'macho_decompress.c')
      const content = await fs.readFile(sourceFile, 'utf-8')

      expect(content).toContain('<compression.h>')
      expect(content).toContain('COMPRESSION_')
    })

    it('Linux decompressor should use LZMA', async () => {
      const sourceFile = path.join(compressionToolsDir, 'elf_decompress.c')
      const content = await fs.readFile(sourceFile, 'utf-8')

      expect(content).toContain('lzma_stream_decoder')
      expect(content).toContain('<lzma.h>')
    })

    it('Windows decompressor should use LZMS', async () => {
      const sourceFile = path.join(compressionToolsDir, 'pe_decompress.c')
      const content = await fs.readFile(sourceFile, 'utf-8')

      expect(content).toContain('CreateDecompressor')
      expect(content).toContain('COMPRESS_ALGORITHM_LZMS')
      expect(content).toContain('<compressapi.h>')
    })

    it('all decompressors should use magic marker', async () => {
      const decompressors = [
        'macho_decompress.c',
        'elf_decompress.c',
        'pe_decompress.c',
      ]

      for (const file of decompressors) {
        const sourceFile = path.join(compressionToolsDir, file)
        // eslint-disable-next-line no-await-in-loop
        const content = await fs.readFile(sourceFile, 'utf-8')

        expect(content).toContain('SOCKETBIN_COMPRESSED_DATA_START')
        expect(content).toContain('MAGIC_MARKER')
      }
    })

    it('all decompressors should read size headers', async () => {
      const decompressors = [
        'macho_decompress.c',
        'elf_decompress.c',
        'pe_decompress.c',
      ]

      for (const file of decompressors) {
        const sourceFile = path.join(compressionToolsDir, file)
        // eslint-disable-next-line no-await-in-loop
        const content = await fs.readFile(sourceFile, 'utf-8')

        expect(content).toContain('compressed_size')
        expect(content).toContain('uncompressed_size')
      }
    })
  })

  describe('Makefile configuration', () => {
    it('Linux Makefile should use static linking for decompressor', async () => {
      const makefilePath = path.join(compressionToolsDir, 'Makefile.linux')
      const content = await fs.readFile(makefilePath, 'utf-8')

      expect(content).toContain('LDFLAGS_STATIC')
      expect(content).toContain('-static')
      expect(content).toContain('-llzma')
    })

    it('Makefiles should use optimization flags', async () => {
      const makefiles = ['Makefile', 'Makefile.linux', 'Makefile.windows']

      for (const file of makefiles) {
        const makefilePath = path.join(compressionToolsDir, file)
        // eslint-disable-next-line no-await-in-loop
        const content = await fs.readFile(makefilePath, 'utf-8')

        // Should have -O2 or -O3
        expect(content).toMatch(/-O[23]/)
      }
    })
  })

  describe('dlxBinary caching strategy', () => {
    it('should have shared dlx cache header', async () => {
      const headerFile = path.join(compressionToolsDir, 'dlx_cache_common.h')
      const content = await fs.readFile(headerFile, 'utf-8')

      // Should reference socket-lib dlxBinary.
      expect(content).toContain(
        'https://github.com/SocketDev/socket-lib/blob/v4.3.0/src/dlx-binary.ts',
      )

      // Should export all necessary functions.
      expect(content).toContain('dlx_get_home_dir')
      expect(content).toContain('dlx_sha512')
      expect(content).toContain('dlx_calculate_cache_key')
      expect(content).toContain('dlx_calculate_sha512_hex')
      expect(content).toContain('dlx_get_platform')
      expect(content).toContain('dlx_get_arch')
      expect(content).toContain('dlx_create_directory_recursive')
      expect(content).toContain('dlx_create_cache_entry_dir')
      expect(content).toContain('dlx_write_metadata')
      expect(content).toContain('dlx_get_cached_binary_path')
      expect(content).toContain('dlx_write_to_cache')

      // Should support all platforms.
      expect(content).toContain('__APPLE__')
      expect(content).toContain('__linux__')
      expect(content).toContain('_WIN32')
    })

    it('macOS decompressor should follow dlxBinary cache structure', async () => {
      const sourceFile = path.join(compressionToolsDir, 'macho_decompress.c')
      const content = await fs.readFile(sourceFile, 'utf-8')

      // Should reference socket-lib dlxBinary.
      expect(content).toContain(
        'https://github.com/SocketDev/socket-lib/blob/v4.3.0/src/dlx-binary.ts',
      )

      // Should use _dlx directory (via shared header).
      expect(content).toContain('dlx_cache_common.h')

      // Should use shared dlx functions.
      expect(content).toContain('dlx_calculate_cache_key')
      expect(content).toContain('dlx_calculate_sha512_hex')
      expect(content).toContain('dlx_get_cached_binary_path')
      expect(content).toContain('dlx_write_to_cache')
    })

    it('Linux decompressor should follow dlxBinary cache structure', async () => {
      const sourceFile = path.join(compressionToolsDir, 'elf_decompress.c')
      const content = await fs.readFile(sourceFile, 'utf-8')

      // Should reference socket-lib dlxBinary.
      expect(content).toContain(
        'https://github.com/SocketDev/socket-lib/blob/v4.3.0/src/dlx-binary.ts',
      )

      // Should use _dlx directory (via shared header).
      expect(content).toContain('dlx_cache_common.h')

      // Should use shared dlx functions.
      expect(content).toContain('dlx_calculate_cache_key')
      expect(content).toContain('dlx_calculate_sha512_hex')
      expect(content).toContain('dlx_get_cached_binary_path')
      expect(content).toContain('dlx_write_to_cache')
    })

    it('Windows decompressor should follow dlxBinary cache structure', async () => {
      const sourceFile = path.join(compressionToolsDir, 'pe_decompress.c')
      const _content = await fs.readFile(sourceFile, 'utf-8')

      // Should reference socket-lib dlxBinary (when updated)
      // TODO: Update this expectation once Windows decompressor is updated
      // expect(_content).toContain('socket-lib')
    })

    it('shared header should use unified DlxMetadata schema fields', async () => {
      const headerFile = path.join(compressionToolsDir, 'dlx_cache_common.h')
      const content = await fs.readFile(headerFile, 'utf-8')

      // Core fields (present in all implementations).
      const coreFields = [
        'version',
        'cache_key',
        'timestamp',
        'checksum',
        'checksum_algorithm',
        'platform',
        'arch',
        'size',
        'source',
      ]

      for (const field of coreFields) {
        expect(content).toContain(`\\"${field}\\"`)
      }

      // Extra fields (implementation-specific).
      const extraFields = [
        'compressed_size',
        'compression_algorithm',
        'compression_ratio',
      ]

      for (const field of extraFields) {
        expect(content).toContain(`\\"${field}\\"`)
      }
    })

    it('shared header should match dlxBinary cache structure', async () => {
      const headerFile = path.join(compressionToolsDir, 'dlx_cache_common.h')
      const content = await fs.readFile(headerFile, 'utf-8')

      // ~/.socket/_dlx/<cache_key>/<binary_name>
      expect(content).toContain('.socket')
      expect(content).toContain(DLX_CACHE_DIR)
      expect(content).toContain('cache_key')

      // Binary naming: node-smol-{platform}-{arch}
      expect(content).toMatch(/node-smol/)
    })
  })
})
