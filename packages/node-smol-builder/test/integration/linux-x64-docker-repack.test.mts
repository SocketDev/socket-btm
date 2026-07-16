import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * @file Linux-x64 Docker repacking and build artifact integration tests.
 *   Split out of linux-x64-docker.test.mts to keep each file under the
 *   500-line soft cap.
 *
 *   - Repacking verification (repack cycles, multiple repack cycles)
 *   - Build artifacts verification (ELF format, executable bit, size)
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { makeExecutable } from 'build-infra/lib/build-helpers'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { MACHO_SEGMENT_NODE_SEA } from 'bin-infra/test/helpers/segment-names'
import { runBinject } from '../helpers/binject.mts'
import { getLatestFinalBinary } from '../paths.mts'

const finalBinaryPath = getLatestFinalBinary()

const isLinux = os.platform() === 'linux'
const skipTests = !isLinux || !finalBinaryPath || !existsSync(finalBinaryPath)

const testTmpDir = path.join(
  os.tmpdir(),
  'socket-btm-linux-x64-docker-repack-tests',
)

describe.skipIf(skipTests)(
  'linux-x64 Docker build integration — repacking and artifacts',
  () => {
    beforeAll(async () => {
      await fs.mkdir(testTmpDir, { recursive: true })
    })

    afterAll(async () => {
      await safeDelete(testTmpDir)
    })

    describe('repacking verification', () => {
      it(
        'should repack SEA without extraction/execution errors',
        { timeout: 45_000 },
        async () => {
          const testDir = path.join(testTmpDir, 'repack-test')
          await fs.mkdir(testDir, { recursive: true })

          // Create initial SEA application
          const appJs = path.join(testDir, 'app.js')
          await fs.writeFile(
            appJs,
            `console.log('Initial SEA application');
console.log('Version:', process.version);
`,
          )

          const seaConfig = path.join(testDir, 'sea-config.json')
          await fs.writeFile(
            seaConfig,
            JSON.stringify({
              disableExperimentalSEAWarning: true,
              main: 'app.js',
              output: 'app.blob',
            }),
          )

          // Create first SEA binary
          const seaBinary1 = path.join(testDir, 'app-v1')
          await fs.copyFile(finalBinaryPath, seaBinary1)
          await makeExecutable(seaBinary1)

          const inject1Result = await runBinject(
            seaBinary1,
            'NODE_SEA_BLOB',
            'sea-config.json',
            {
              machoSegmentName: MACHO_SEGMENT_NODE_SEA,
              sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
              testDir,
            },
          )
          expect(inject1Result.code).toBe(0)

          // Test first binary
          const exec1Result = await spawn(seaBinary1, [], {
            cwd: testDir,
            timeout: 10_000,
          })
          expect(exec1Result.code).toBe(0)
          expect(exec1Result.stdout).toContain('Initial SEA application')

          // Create updated application
          const appV2Js = path.join(testDir, 'app-v2.js')
          await fs.writeFile(
            appV2Js,
            `console.log('Repacked SEA application');
console.log('Version:', process.version);
console.log('Platform:', process.platform);
`,
          )

          const seaConfigV2 = path.join(testDir, 'sea-config-v2.json')
          await fs.writeFile(
            seaConfigV2,
            JSON.stringify({
              disableExperimentalSEAWarning: true,
              main: 'app-v2.js',
              output: 'app-v2.blob',
            }),
          )

          // Repack: copy the stub again and inject new SEA
          const seaBinary2 = path.join(testDir, 'app-v2')
          await fs.copyFile(finalBinaryPath, seaBinary2)
          await makeExecutable(seaBinary2)

          const inject2Result = await runBinject(
            seaBinary2,
            'NODE_SEA_BLOB',
            'sea-config-v2.json',
            {
              machoSegmentName: MACHO_SEGMENT_NODE_SEA,
              sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
              testDir,
            },
          )
          expect(inject2Result.code).toBe(0)
          expect(inject2Result.stdout).not.toContain('error')

          // Test repacked binary - should NOT have extraction errors
          const exec2Result = await spawn(seaBinary2, [], {
            cwd: testDir,
            timeout: 10_000,
          })
          expect(exec2Result.code).toBe(0)
          expect(exec2Result.stdout).toContain('Repacked SEA application')
          expect(exec2Result.stdout).toContain('Platform: linux')
          expect(exec2Result.stderr).not.toContain('error')
          expect(exec2Result.stderr).not.toContain('extraction failed')
          expect(exec2Result.stderr).not.toContain('segfault')
        },
      )

      it(
        'should handle multiple repack cycles without errors',
        { timeout: 60_000 },
        async () => {
          const testDir = path.join(testTmpDir, 'multi-repack-test')
          await fs.mkdir(testDir, { recursive: true })

          const versions = ['v1', 'v2', 'v3']

          for (let i = 0, { length } = versions; i < length; i += 1) {
            const version = versions[i]
            // Create application for this version
            const appJs = path.join(testDir, `app-${version}.js`)
            // eslint-disable-next-line no-await-in-loop
            await fs.writeFile(
              appJs,
              `console.log('Application ${version}');
console.log('Node version:', process.version);
`,
            )

            const seaConfig = path.join(testDir, `sea-config-${version}.json`)
            // eslint-disable-next-line no-await-in-loop
            await fs.writeFile(
              seaConfig,
              JSON.stringify({
                disableExperimentalSEAWarning: true,
                main: `app-${version}.js`,
                output: `app-${version}.blob`,
              }),
            )

            // Create SEA binary
            const seaBinary = path.join(testDir, `app-${version}`)
            // eslint-disable-next-line no-await-in-loop
            await fs.copyFile(finalBinaryPath, seaBinary)
            // eslint-disable-next-line no-await-in-loop
            await makeExecutable(seaBinary)

            // eslint-disable-next-line no-await-in-loop
            const injectResult = await runBinject(
              seaBinary,
              'NODE_SEA_BLOB',
              `sea-config-${version}.json`,
              {
                machoSegmentName: MACHO_SEGMENT_NODE_SEA,
                sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
                testDir,
              },
            )
            expect(injectResult.code).toBe(0)

            // Test execution
            // eslint-disable-next-line no-await-in-loop
            const execResult = await spawn(seaBinary, [], {
              cwd: testDir,
              timeout: 10_000,
            })
            expect(execResult.code).toBe(0)
            expect(execResult.stdout).toContain(`Application ${version}`)
            expect(execResult.stderr).not.toContain('error')
            expect(execResult.stderr).not.toContain('segfault')
          }
        },
      )
    })

    describe('build artifacts verification', () => {
      it('should have correct ELF binary format for linux-x64', async () => {
        // Check that the binary is a valid ELF executable
        const fileResult = await spawn('file', [finalBinaryPath])
        expect(fileResult.code).toBe(0)
        expect(fileResult.stdout).toContain('ELF')
        expect(fileResult.stdout).toContain('x86-64')
        expect(fileResult.stdout).toContain('executable')
      })

      it('should be executable', async () => {
        // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size and stats.mode to verify extracted/final Linux x64 binaries.
        const stat = await fs.stat(finalBinaryPath)

        // Check executable bit
        expect(stat.mode & 0o111).toBeTruthy()
      })

      it('should have reasonable size', async () => {
        // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size and stats.mode to verify extracted/final Linux x64 binaries.
        const stat = await fs.stat(finalBinaryPath)
        // Node.js binaries should be between 10MB and 200MB
        // > 10MB
        expect(stat.size).toBeGreaterThan(10 * 1024 * 1024)
        // < 200MB
        expect(stat.size).toBeLessThan(200 * 1024 * 1024)
      })
    })
  },
)
