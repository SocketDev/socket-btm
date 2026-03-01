#!/usr/bin/env node
/**
 * Sync fast-webstreams vendor from node_modules
 *
 * Extracts experimental-fast-webstreams from node_modules, converts ES modules to CommonJS,
 * and places in the vendor directory for use in Node.js additions.
 *
 * The package is managed as a devDependency for taze updates and grace period tracking.
 *
 * Usage: node scripts/vendor-fast-webstreams/sync.mjs
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDeleteSync } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { readPackageJson } from '@socketsecurity/lib/packages/operations'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PACKAGE_NAME = 'experimental-fast-webstreams'
const PACKAGE_ROOT = path.resolve(__dirname, '../..')
const NODE_MODULES_PKG = path.join(PACKAGE_ROOT, 'node_modules', PACKAGE_NAME)
const VENDOR_DIR = path.resolve(
  __dirname,
  '../../additions/source-patched/deps/fast-webstreams',
)

/**
 * Convert relative paths to absolute internal paths
 * Node.js internal module system doesn't resolve relative paths like regular Node.js
 * It prepends 'internal/deps/' to the path, so './file' becomes 'internal/deps/./file'
 * We need to convert './file' to 'internal/deps/fast-webstreams/file' (absolute internal path)
 * Also strips .js extension since js2c strips it from module names
 */
function toInternalPath(source) {
  // Convert relative paths to absolute internal paths
  if (source.startsWith('./')) {
    const basename = source.slice(2).replace(/\.js$/, '')
    return `internal/deps/fast-webstreams/${basename}`
  }
  if (source.startsWith('../')) {
    // Parent paths shouldn't occur within fast-webstreams, but handle gracefully
    const basename = source.replace(/^\.\.\//, '').replace(/\.js$/, '')
    return `internal/deps/${basename}`
  }
  return source
}

/**
 * Convert ES module to CommonJS
 *
 * IMPORTANT: Uses individual exports.X = X at the end to support circular dependencies.
 * In CommonJS circular deps, the key is that all exports must be assigned before
 * the module that depends on them tries to use them. For this library, functions
 * like _getDesiredSize are called at runtime (not at module load time), so as long
 * as exports are populated by the end of module execution, circular deps work.
 */
function convertToCommonJS(content, _filename) {
  let result = content

  // Add 'use strict' at the top
  if (!result.startsWith("'use strict'")) {
    result = `'use strict'\n\n${result}`
  }

  // Collect exports for individual exports.X = X at the end
  const localExports = new Set()
  // Collect re-exports that need to be spread into module.exports
  const reExports = []

  // Handle: export { X, Y } from './file.js' (re-exports)
  result = result.replace(
    /export\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g,
    (_match, items, source) => {
      const normalizedSource = source.replace(/^node:/, '')
      const names = items.split(',').map(item => {
        const parts = item.trim().split(/\s+as\s+/)
        const original = parts[0].trim()
        const alias = parts.length > 1 ? parts[1].trim() : original
        return { original, alias }
      })
      // Generate require + re-export
      const tempVar = `_reexport_${reExports.length}`
      const requirePath = toInternalPath(normalizedSource)
      reExports.push({ tempVar, source: requirePath, names })
      return `const ${tempVar} = require('${requirePath}')`
    },
  )

  // Convert imports to requires
  // Handle: import { X, Y } from './file.js'
  // Convert 'as' to ':' for CJS destructuring (e.g., { pipeline as foo } → { pipeline: foo })
  result = result.replace(
    /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g,
    (_match, imports, source) => {
      const normalizedSource = source.replace(/^node:/, '')
      // Convert 'X as Y' to 'X: Y' for CommonJS destructuring
      const convertedImports = imports
        .split(',')
        .map(item => item.trim().replace(/\s+as\s+/g, ': '))
        .join(', ')
      return `const { ${convertedImports} } = require('${toInternalPath(normalizedSource)}')`
    },
  )

  // Handle: import X from './file.js'
  result = result.replace(
    /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
    (_match, name, source) => {
      const normalizedSource = source.replace(/^node:/, '')
      return `const ${name} = require('${toInternalPath(normalizedSource)}')`
    },
  )

  // Handle: import * as X from './file.js'
  result = result.replace(
    /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
    (_match, name, source) => {
      const normalizedSource = source.replace(/^node:/, '')
      return `const ${name} = require('${toInternalPath(normalizedSource)}')`
    },
  )

  // Convert: export const X = ...
  result = result.replace(/export\s+const\s+(\w+)\s*=/g, (_match, name) => {
    localExports.add(name)
    return `const ${name} =`
  })

  // Convert: export function X(...) {
  result = result.replace(/export\s+function\s+(\w+)\s*\(/g, (_match, name) => {
    localExports.add(name)
    return `function ${name}(`
  })

  // Convert: export async function X(...) {
  result = result.replace(
    /export\s+async\s+function\s+(\w+)\s*\(/g,
    (_match, name) => {
      localExports.add(name)
      return `async function ${name}(`
    },
  )

  // Convert: export class X {
  result = result.replace(/export\s+class\s+(\w+)/g, (_match, name) => {
    localExports.add(name)
    return `class ${name}`
  })

  // Handle: export { X, Y } (local exports without from)
  result = result.replace(
    /export\s*\{\s*([^}]+)\s*\}(?!\s*from)/g,
    (_match, items) => {
      for (const item of items.split(',')) {
        const name = item
          .trim()
          .split(/\s+as\s+/)[0]
          .trim()
        if (name) {
          localExports.add(name)
        }
      }
      return '' // Remove the export statement
    },
  )

  // Build individual exports at the end
  // This works for circular deps because the exports are populated by module end,
  // and the dependent module accesses them at function call time (not module load time)
  const exportLines = []

  // Add re-exports
  for (const { names, tempVar } of reExports) {
    for (const { alias, original } of names) {
      exportLines.push(`exports.${alias} = ${tempVar}.${original};`)
    }
  }

  // Add local exports
  for (const name of Array.from(localExports).sort()) {
    exportLines.push(`exports.${name} = ${name};`)
  }

  if (exportLines.length > 0) {
    result += `\n\n${exportLines.join('\n')}\n`
  }

  return result
}

/**
 * Fix circular dependency in patch.js
 * patch.js imports from index.js, but index.js re-exports from patch.js
 * Fix by making patch.js import directly from the source modules
 */
function fixPatchCircularDependency(content, filename) {
  if (filename !== 'patch.js') {
    return content
  }

  // Replace: const { FastReadableStream, FastTransformStream, FastWritableStream } = require('internal/deps/fast-webstreams/index');
  // With direct requires to avoid circular dependency
  // Note: must use absolute internal paths since Node.js internal module system doesn't resolve relative paths
  return content.replace(
    /const\s*\{\s*FastReadableStream,\s*FastTransformStream,\s*FastWritableStream\s*\}\s*=\s*require\(['"]internal\/deps\/fast-webstreams\/index['"]\)/,
    `const { FastReadableStream } = require('internal/deps/fast-webstreams/readable')
const { FastTransformStream } = require('internal/deps/fast-webstreams/transform')
const { FastWritableStream } = require('internal/deps/fast-webstreams/writable')`,
  )
}

/**
 * Fix circular dependency between writer.js and writable.js
 *
 * Problem: writable.js imports from writer.js, and writer.js imports from writable.js.
 * In CommonJS, when writable.js requires writer.js, writer.js tries to destructure
 * from writable.js's exports - but writable.js hasn't finished executing yet.
 *
 * Solution: In writer.js, don't destructure at the top. Instead:
 * 1. Get the module reference: const _writable = require('writable');
 * 2. Access exports at runtime when functions are called (not at module load)
 *
 * This works because the functions that use _writable exports are called after
 * both modules have finished loading (at runtime, not at module load time).
 */
function fixWriterWritableCycle(content, filename) {
  if (filename !== 'writer.js') {
    return content
  }

  // Change destructuring import to module reference
  content = content.replace(
    /const\s*\{\s*_abortInternal,\s*_closeFromWriter,\s*_getDesiredSize,\s*_writeInternal\s*\}\s*=\s*require\(['"]internal\/deps\/fast-webstreams\/writable['"]\)/,
    `const _writable = require('internal/deps/fast-webstreams/writable')`,
  )

  // Replace direct calls with module access
  // _getDesiredSize(... → _writable._getDesiredSize(...
  content = content.replace(
    /\b_getDesiredSize\(/g,
    '_writable._getDesiredSize(',
  )
  content = content.replace(/\b_abortInternal\(/g, '_writable._abortInternal(')
  content = content.replace(
    /\b_closeFromWriter\(/g,
    '_writable._closeFromWriter(',
  )
  content = content.replace(/\b_writeInternal\(/g, '_writable._writeInternal(')

  return content
}

/**
 * Add primordials protection to all fast-webstreams files
 *
 * Replaces direct Promise.* calls with primordials equivalents:
 * - Promise.resolve() → PromiseResolve()
 * - Promise.reject() → PromiseReject()
 * - new Promise() → new SafePromise()
 * - Promise.all() → SafePromiseAllReturnVoid() (pipe-to.js only)
 *
 * This protects against prototype pollution attacks on Promise methods.
 */
function addPrimordialsProtection(content, filename) {
  // Check if this file uses any Promise patterns that need protection
  const usesPromiseResolve = /Promise\.resolve\s*\(/g.test(content)
  const usesPromiseReject = /Promise\.reject\s*\(/g.test(content)
  const usesNewPromise = /new\s+Promise\s*\(/g.test(content)
  const usesPromiseAll = /Promise\.all\s*\(/g.test(content)

  const needsPrimordials =
    usesPromiseResolve || usesPromiseReject || usesNewPromise || usesPromiseAll

  if (!needsPrimordials) {
    return content
  }

  // Build the primordials import based on what's needed
  const primordialImports = []
  if (usesPromiseResolve) primordialImports.push('PromiseResolve')
  if (usesPromiseReject) primordialImports.push('PromiseReject')
  if (usesNewPromise) primordialImports.push('SafePromise')
  if (usesPromiseAll) primordialImports.push('SafePromiseAllReturnVoid')

  // Find insertion point - after 'use strict' and any initial requires
  // Insert primordials import at the top, right after 'use strict'
  const useStrictMatch = content.match(/^'use strict'\s*\n/)
  if (useStrictMatch) {
    const insertPoint = useStrictMatch[0].length
    const primordialsComment =
      '// Use primordials for protection against prototype pollution'
    const primordialsImport = `const {\n  ${primordialImports.join(',\n  ')},\n} = primordials`

    content =
      content.slice(0, insertPoint) +
      `\n${primordialsComment}\n${primordialsImport}\n` +
      content.slice(insertPoint)
  }

  // Replace Promise patterns with primordials
  if (usesPromiseResolve) {
    content = content.replace(/Promise\.resolve\s*\(/g, 'PromiseResolve(')
  }
  if (usesPromiseReject) {
    content = content.replace(/Promise\.reject\s*\(/g, 'PromiseReject(')
  }
  if (usesNewPromise) {
    content = content.replace(/new\s+Promise\s*\(/g, 'new SafePromise(')
  }
  if (usesPromiseAll) {
    content = content.replace(/Promise\.all\s*\(/g, 'SafePromiseAllReturnVoid(')
  }

  return content
}

/**
 * Process and convert source files from node_modules
 */
async function processSourceFiles() {
  const srcDir = path.join(NODE_MODULES_PKG, 'src')
  if (!existsSync(srcDir)) {
    throw new Error(`Source directory not found: ${srcDir}`)
  }

  // Clean vendor directory
  safeDeleteSync(VENDOR_DIR)
  mkdirSync(VENDOR_DIR, { recursive: true })

  // Process each source file
  const files = readdirSync(srcDir).filter(f => f.endsWith('.js'))
  logger.info(`Processing ${files.length} source files...`)

  for (const file of files) {
    const srcPath = path.join(srcDir, file)
    const content = readFileSync(srcPath, 'utf8')
    let converted = convertToCommonJS(content, file)
    // Fix circular dependencies
    converted = fixPatchCircularDependency(converted, file)
    converted = fixWriterWritableCycle(converted, file)
    // Add primordials for security (must be last to catch all Promise patterns)
    converted = addPrimordialsProtection(converted, file)
    const destPath = path.join(VENDOR_DIR, file)
    writeFileSync(destPath, converted)
    logger.info(`  Converted: ${file}`)
  }

  // Create version file
  const versionFile = path.join(VENDOR_DIR, 'VERSION')
  const pkgJson = JSON.parse(
    readFileSync(path.join(NODE_MODULES_PKG, 'package.json'), 'utf8'),
  )
  writeFileSync(
    versionFile,
    `Package: ${PACKAGE_NAME}\nVersion: ${pkgJson.version}\nSynced: ${new Date().toISOString()}\n`,
  )

  // Copy package.json but remove the type field
  // Node.js internal module system (js2c) doesn't use package.json type resolution
  const vendorPkgPath = path.join(VENDOR_DIR, 'package.json')
  const editablePkgJson = await readPackageJson(
    path.join(NODE_MODULES_PKG, 'package.json'),
    { editable: true },
  )
  editablePkgJson.update({ type: undefined })
  writeFileSync(
    vendorPkgPath,
    `${JSON.stringify(editablePkgJson.content, null, 2)}\n`,
  )

  return files.length
}

/**
 * Main
 */
async function main() {
  try {
    logger.info('=== fast-webstreams Vendor Sync ===\n')

    // Check node_modules package exists
    if (!existsSync(NODE_MODULES_PKG)) {
      throw new Error(
        `Package not found in node_modules: ${NODE_MODULES_PKG}\n` +
          'Run "pnpm install" first to install dependencies.',
      )
    }

    // Get version from node_modules
    const pkgJson = JSON.parse(
      readFileSync(path.join(NODE_MODULES_PKG, 'package.json'), 'utf8'),
    )
    logger.info(`Source: node_modules/${PACKAGE_NAME}`)
    logger.info(`Version: ${pkgJson.version}`)

    // Process and convert files
    const fileCount = await processSourceFiles()

    logger.info('\n=== Sync Complete ===')
    logger.info(`Version: ${pkgJson.version}`)
    logger.info(`Files: ${fileCount}`)
    logger.info(`Output: ${VENDOR_DIR}`)
  } catch (error) {
    logger.fail('Sync failed:', error.message)
    process.exitCode = 1
  }
}

main()
