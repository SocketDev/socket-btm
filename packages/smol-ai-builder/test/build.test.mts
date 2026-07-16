import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  cmakeConfigureArgs,
  nodeDevelopmentCandidates,
} from '../scripts/build.mts'

describe('smol-ai native build', () => {
  it('pins an explicit build mode and Node header boundary', () => {
    const args = cmakeConfigureArgs({
      buildDir: '/tmp/smol-ai',
      mode: 'prod',
      nodeIncludeDir: '/opt/node/include/node',
    })

    expect(args).toContain('-DCMAKE_BUILD_TYPE=Release')
    expect(args).toContain('-DNODE_INCLUDE_DIR=/opt/node/include/node')
    expect(args).not.toEqual(
      expect.arrayContaining([expect.stringContaining('NODE_IMPORT_LIBRARY')]),
    )
    expect(path.basename(args[1]!)).toBe('language-model-infra')
  })

  it('passes the Node import library only for Windows callers', () => {
    const args = cmakeConfigureArgs({
      buildDir: 'C:\\build',
      mode: 'dev',
      nodeImportLibrary: 'C:\\node\\node.lib',
      nodeIncludeDir: 'C:\\node\\include',
    })

    expect(args).toContain('-DCMAKE_BUILD_TYPE=Debug')
    expect(args).toContain('-DNODE_IMPORT_LIBRARY=C:\\node\\node.lib')
  })

  it('checks both executable-adjacent and prefix Node development files', () => {
    expect(nodeDevelopmentCandidates('/opt/node/26/bin/node')).toStrictEqual({
      importLibraries: ['/opt/node/26/bin/node.lib', '/opt/node/26/node.lib'],
      includeDirs: [
        '/opt/node/26/bin/include/node',
        '/opt/node/26/include/node',
      ],
    })
  })
})
