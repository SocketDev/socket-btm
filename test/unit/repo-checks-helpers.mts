import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function makeRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'btm-repo-checks-'))
}
