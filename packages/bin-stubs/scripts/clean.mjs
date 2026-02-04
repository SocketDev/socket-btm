#!/usr/bin/env node
/**
 * Clean script for bin-stubs package.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib/fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

async function clean() {
  const dirsToClean = ['build', 'out']

  for (const dir of dirsToClean) {
    const fullPath = path.join(packageRoot, dir)
    try {
      await fs.access(fullPath)
      await safeDelete(fullPath)
      console.log(`✓ Deleted ${dir}/`)
    } catch {
      // Directory doesn't exist, skip it.
    }
  }
}

clean().catch(error => {
  console.error('Error during clean:', error)
  process.exit(1)
})
