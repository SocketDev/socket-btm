/**
 * @file Tests for the checkpoint build-inputs fingerprint: stability,
 *   sensitivity, and the restore-refusal decision gate.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { describe, expect, it } from 'vitest'

import {
  computeBuildInputsFingerprint,
  formatStaleCheckpointMessage,
  isCheckpointFingerprintCurrent,
} from '../lib/checkpoint-cache-key.mts'

describe('checkpoint-cache-key', () => {
  describe(computeBuildInputsFingerprint, () => {
    it('is stable for identical inputs (same dirs, content, node version)', async () => {
      const tempDir = path.join(
        os.tmpdir(),
        `checkpoint-fingerprint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      const additionsDir = path.join(tempDir, 'additions')
      await fs.mkdir(additionsDir, { recursive: true })
      await fs.writeFile(path.join(additionsDir, 'a.js'), 'console.log(1)')

      try {
        const first = computeBuildInputsFingerprint({
          dirs: [additionsDir],
          nodeVersion: '25.0.0',
        })
        const second = computeBuildInputsFingerprint({
          dirs: [additionsDir],
          nodeVersion: '25.0.0',
        })

        expect(first).toBe(second)
        expect(first).toMatch(/^[a-f0-9]{64}$/)
      } finally {
        await safeDelete(tempDir)
      }
    })

    it('changes when a single byte in a tracked file changes', async () => {
      const tempDir = path.join(
        os.tmpdir(),
        `checkpoint-fingerprint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      const additionsDir = path.join(tempDir, 'additions')
      await fs.mkdir(additionsDir, { recursive: true })
      const filePath = path.join(additionsDir, 'a.js')
      await fs.writeFile(filePath, 'console.log(1)')

      try {
        const before = computeBuildInputsFingerprint({
          dirs: [additionsDir],
          nodeVersion: '25.0.0',
        })

        // Flip a single byte — the reproduced bug's actual shape: a small
        // content change under additions/ must invalidate the fingerprint.
        await fs.writeFile(filePath, 'console.log(2)')

        const after = computeBuildInputsFingerprint({
          dirs: [additionsDir],
          nodeVersion: '25.0.0',
        })

        expect(after).not.toBe(before)
      } finally {
        await safeDelete(tempDir)
      }
    })

    it('changes when the node version changes but dirs are identical', async () => {
      const tempDir = path.join(
        os.tmpdir(),
        `checkpoint-fingerprint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      const patchesDir = path.join(tempDir, 'patches')
      await fs.mkdir(patchesDir, { recursive: true })
      await fs.writeFile(path.join(patchesDir, '001.patch'), 'diff --git a b')

      try {
        const v25 = computeBuildInputsFingerprint({
          dirs: [patchesDir],
          nodeVersion: '25.0.0',
        })
        const v26 = computeBuildInputsFingerprint({
          dirs: [patchesDir],
          nodeVersion: '26.0.0',
        })

        expect(v25).not.toBe(v26)
      } finally {
        await safeDelete(tempDir)
      }
    })

    it('is deterministic when one of the dirs does not exist (patches/ absent)', () => {
      const missingDir = path.join(
        os.tmpdir(),
        `checkpoint-fingerprint-missing-${Date.now()}`,
      )

      const first = computeBuildInputsFingerprint({
        dirs: [missingDir],
        nodeVersion: '25.0.0',
      })
      const second = computeBuildInputsFingerprint({
        dirs: [missingDir],
        nodeVersion: '25.0.0',
      })

      expect(first).toBe(second)
      expect(first).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe(isCheckpointFingerprintCurrent, () => {
    it('accepts a restore when the stored fingerprint matches the current one', () => {
      const fresh = isCheckpointFingerprintCurrent({
        checkpointData: { inputsFingerprint: 'abc123' },
        currentFingerprint: 'abc123',
      })

      expect(fresh).toBe(true)
    })

    it('refuses a restore when the stored fingerprint differs (stale checkpoint)', () => {
      const fresh = isCheckpointFingerprintCurrent({
        checkpointData: { inputsFingerprint: 'stale-hash' },
        currentFingerprint: 'current-hash',
      })

      expect(fresh).toBe(false)
    })

    it('refuses a restore when the checkpoint has no stored fingerprint (legacy checkpoint)', () => {
      const fresh = isCheckpointFingerprintCurrent({
        checkpointData: { name: 'finalized' },
        currentFingerprint: 'current-hash',
      })

      expect(fresh).toBe(false)
    })

    it('refuses a restore when checkpoint data itself is undefined (no checkpoint found)', () => {
      const fresh = isCheckpointFingerprintCurrent({
        checkpointData: undefined,
        currentFingerprint: 'current-hash',
      })

      expect(fresh).toBe(false)
    })
  })

  describe(formatStaleCheckpointMessage, () => {
    it('states what, where, saw-vs-wanted, and the fix', () => {
      const message = formatStaleCheckpointMessage({
        checkpointFile: '/build/dev/darwin-arm64/checkpoints/finalized.json',
        checkpointName: 'finalized',
        currentFingerprint: 'current-hash',
        savedFingerprint: 'stale-hash',
      })

      expect(message).toContain("'finalized' was saved")
      expect(message).toContain(
        '/build/dev/darwin-arm64/checkpoints/finalized.json',
      )
      expect(message).toContain('stale-hash')
      expect(message).toContain('current-hash')
      expect(message).toContain('rebuilding from source')
    })

    it('labels a missing fingerprint as a legacy checkpoint', () => {
      const message = formatStaleCheckpointMessage({
        checkpointFile: '/build/dev/darwin-arm64/checkpoints/finalized.json',
        checkpointName: 'finalized',
        currentFingerprint: 'current-hash',
        savedFingerprint: undefined,
      })

      expect(message).toContain('legacy checkpoint')
    })
  })
})
