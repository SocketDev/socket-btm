/**
 * @fileoverview Tests for node:smol-vfs module
 *
 * LIMITATION: The node:smol-vfs module only works inside SEA (Single Executable Application)
 * binaries. It cannot be imported directly in Jest because it depends on:
 * - internalBinding('smol_vfs') - only available in patched Node.js
 * - VFS archive embedded in the binary at runtime
 *
 * These tests verify the TypeScript API definitions match expected structure.
 * Functional testing happens in integration tests that run inside SEA binaries.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('node:smol-vfs TypeScript definitions', () => {
  const dtsPath = path.resolve(
    __dirname,
    '../../additions/source-patched/typings/node_smol-vfs.d.ts',
  )

  let dtsContent: string

  beforeAll(async () => {
    dtsContent = await fs.readFile(dtsPath, 'utf8')
  })

  describe('Core state exports', () => {
    it('should export core state functions', () => {
      expect(dtsContent).toMatch(/export function hasVFS\(\): boolean/)
      expect(dtsContent).toMatch(/export function config\(\):/)
      expect(dtsContent).toMatch(/export function prefix\(\): string/)
      expect(dtsContent).toMatch(/export function size\(\): number/)
      expect(dtsContent).toMatch(/export function canBuildSea\(\): boolean/)
    })
  })

  describe('File operation exports', () => {
    it('should export sync file operations', () => {
      expect(dtsContent).toMatch(/export function existsSync\(filepath: string\): boolean/)
      expect(dtsContent).toMatch(/export function readFileSync\(filepath: string\):/)
      expect(dtsContent).toMatch(/export function statSync\(filepath: string/)
      expect(dtsContent).toMatch(/export function readdirSync\(filepath: string/)
      expect(dtsContent).toMatch(/export function accessSync\(filepath: string/)
    })
  })

  describe('File descriptor exports', () => {
    it('should export file descriptor operations', () => {
      expect(dtsContent).toMatch(/export function openSync\(filepath: string/)
      expect(dtsContent).toMatch(/export function closeSync\(fd: number\): void/)
      expect(dtsContent).toMatch(/export function readSync\(fd: number/)
      expect(dtsContent).toMatch(/export function fstatSync\(fd: number/)
      expect(dtsContent).toMatch(/export function isVfsFd\(fd: number\): boolean/)
      expect(dtsContent).toMatch(/export function getVfsPath\(fd: number\):/)
      expect(dtsContent).toMatch(/export function getRealPath\(fd: number\):/)
    })
  })

  describe('Async operations namespace', () => {
    it('should export promises namespace with async operations', () => {
      expect(dtsContent).toMatch(/export namespace promises \{/)
      expect(dtsContent).toMatch(/export function readFile\(filepath: string/)
      expect(dtsContent).toMatch(/export function stat\(filepath: string/)
      expect(dtsContent).toMatch(/export function readdir\(filepath: string/)
      expect(dtsContent).toMatch(/export function readFileAsJSON/)
      expect(dtsContent).toMatch(/export function readFileAsText/)
      expect(dtsContent).toMatch(/export function readFileAsBuffer/)
      expect(dtsContent).toMatch(/export function readMultiple/)
    })
  })

  describe('VFS-specific exports', () => {
    it('should export VFS-specific operations and helpers', () => {
      expect(dtsContent).toMatch(/export function listFiles\(options\?:/)
      expect(dtsContent).toMatch(/export function mount\(vfsPath: string/)
      expect(dtsContent).toMatch(/export function mountSync\(vfsPath: string/)
      expect(dtsContent).toMatch(/export function handleNativeAddon\(path: string\): string/)
      expect(dtsContent).toMatch(/export function isNativeAddon\(path: string\): boolean/)
      expect(dtsContent).toMatch(/export function isVFSPath\(filepath: string\): boolean/)
      expect(dtsContent).toMatch(/export function getVFSStats\(\):/)
      expect(dtsContent).toMatch(/export function getCacheStats\(\):/)
    })
  })

  describe('Error class export', () => {
    it('should export VFSError class with properties', () => {
      expect(dtsContent).toMatch(/export class VFSError extends Error/)
      expect(dtsContent).toMatch(/code: string/)
      expect(dtsContent).toMatch(/path\?: string/)
      expect(dtsContent).toMatch(/syscall\?: string/)
    })
  })

  describe('Constants', () => {
    it('should export mode constants', () => {
      expect(dtsContent).toMatch(/export const MODE_COMPAT: number/)
      expect(dtsContent).toMatch(/export const MODE_IN_MEMORY: number/)
      expect(dtsContent).toMatch(/export const MODE_ON_DISK: number/)
    })

    it('should export MAX_SYMLINK_DEPTH', () => {
      expect(dtsContent).toMatch(/export const MAX_SYMLINK_DEPTH: 32/)
    })
  })

  describe('Stream support', () => {
    it('should export createReadStream with options', () => {
      expect(dtsContent).toMatch(/export function createReadStream\(filepath: string/)
      expect(dtsContent).toMatch(/start\?: number/)
      expect(dtsContent).toMatch(/end\?: number/)
      expect(dtsContent).toMatch(/encoding\?: BufferEncoding/)
      expect(dtsContent).toMatch(/highWaterMark\?: number/)
    })
  })

  describe('CacheStats interface', () => {
    it('should define CacheStats interface with properties', () => {
      expect(dtsContent).toMatch(/export interface CacheStats/)
      expect(dtsContent).toMatch(/mode: string/)
      expect(dtsContent).toMatch(/cacheDir: string \| undefined/)
      expect(dtsContent).toMatch(/extractedCount: number/)
      expect(dtsContent).toMatch(/persistent: boolean/)
    })
  })
})

describe('node:smol-vfs runtime behavior', () => {
  it.skip('cannot be tested outside SEA environment', () => {
    // This module requires:
    // 1. internalBinding('smol_vfs') - only available in patched Node.js
    // 2. VFS archive embedded in the binary
    // 3. SEA execution context
    //
    // Functional tests live in test/integration/sea-vfs.test.mjs
    // which runs inside an actual SEA binary
  })
})
