/**
 * WASM sync wrapper generation phase for Yoga Layout.
 *
 * Generates synchronous wrapper for WASM module with official yoga-layout API.
 * Uses AST-based transformations (acorn + MagicString) for robust code modification.
 */

import { existsSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { getFileSize } from 'build-infra/lib/build-helpers'
import { generateWasmSyncWrapper } from 'build-infra/wasm-synced/wasm-sync-wrapper'
import MagicString from 'magic-string'

import YGEnums from '../../../src/wrapper/YGEnums.mts'
import { PACKAGE_ROOT } from '../../paths.mts'

const logger = getDefaultLogger()

// Wrapper source files.
const WRAPPER_DIR = path.join(PACKAGE_ROOT, 'src', 'wrapper')
const YG_ENUMS_FILE = path.join(WRAPPER_DIR, 'YGEnums.mts')
const WRAP_ASSEMBLY_FILE = path.join(WRAPPER_DIR, 'wrapAssembly.mts')

/**
 * Generate synchronous wrapper for Yoga Layout WASM.
 *
 * This generates the base WASM sync wrapper, then post-processes it
 * to include the wrapAssembly wrapper for the official yoga-layout API.
 *
 * @param {object} options - Sync generation options
 */
export async function generateSync(options) {
  const {
    buildDir,
    buildMode,
    outputOptimizedDir,
    outputReleaseDir,
    outputSyncDir,
  } = options

  logger.log('Creating synchronous wrapper with wrapAssembly wrapper...')
  logger.logNewline()

  await safeDelete(outputSyncDir)
  await safeMkdir(outputSyncDir)

  // Determine source directory (Optimized for prod, Release for dev).
  const sourceDir = buildMode === 'prod' ? outputOptimizedDir : outputReleaseDir
  const inputWasmFile = path.join(sourceDir, 'yoga.wasm')
  const inputMjsFile = path.join(sourceDir, 'yoga.mjs')

  // Copy to Sync directory.
  const syncWasmFile = path.join(outputSyncDir, 'yoga.wasm')
  const syncMjsFile = path.join(outputSyncDir, 'yoga.mjs')
  const syncCjsFile = path.join(outputSyncDir, 'yoga-sync.cjs')
  const syncEsmFile = path.join(outputSyncDir, 'yoga-sync.mjs')

  await fs.copyFile(inputWasmFile, syncWasmFile)
  if (existsSync(inputMjsFile)) {
    await fs.copyFile(inputMjsFile, syncMjsFile)
  }

  // Read wrapper source files.
  const ygEnumsContent = await fs.readFile(YG_ENUMS_FILE, 'utf8')
  const wrapAssemblyContent = await fs.readFile(WRAP_ASSEMBLY_FILE, 'utf8')

  // Generate base synchronous wrapper.
  await generateWasmSyncWrapper({
    description:
      'Built with official yoga-layout API via wrapAssembly wrapper.',
    exportName: 'yoga',
    initFunctionName: 'Module',
    logger,
    mjsFile: syncMjsFile,
    outputSyncJs: syncCjsFile,
    packageName: 'yoga-layout',
    wasmFile: syncWasmFile,
  })

  // Post-process ESM wrapper to include wrapAssembly.
  await postProcessEsmWrapper(syncEsmFile, ygEnumsContent, wrapAssemblyContent)

  // Post-process CJS wrapper to include wrapAssembly.
  await postProcessCjsWrapper(syncCjsFile, ygEnumsContent, wrapAssemblyContent)

  const syncSize = await getFileSize(syncCjsFile)
  logger.substep(`Sync wrapper: ${syncCjsFile}`)
  logger.substep(`Sync wrapper size: ${syncSize}`)
  logger.logNewline()

  return {
    artifactPath: outputSyncDir,
    binaryPath: path.relative(buildDir, outputSyncDir),
    binarySize: syncSize,
    smokeTest: async () => {
      const _require = createRequire(import.meta.url)
      const syncStats = await fs.stat(syncCjsFile)
      if (syncStats.size === 0) {
        throw new Error('Sync wrapper file is empty')
      }
      const Yoga = _require(syncCjsFile)
      if (typeof Yoga !== 'object' || Yoga === null) {
        throw new Error(
          `Sync wrapper failed to load properly: got ${typeof Yoga}`,
        )
      }
      if (typeof Yoga.Node?.create !== 'function') {
        throw new Error(
          'Sync wrapper missing Node.create() - wrapper not applied',
        )
      }
      if (typeof Yoga.Config?.create !== 'function') {
        throw new Error(
          'Sync wrapper missing Config.create() - wrapper not applied',
        )
      }
      const allEnumNames = Object.keys(YGEnums)
      const missing = []
      for (const name of allEnumNames) {
        if (typeof Yoga[name] !== 'number') {
          missing.push(name)
        } else if (Yoga[name] !== YGEnums[name]) {
          throw new Error(
            `Sync wrapper ${name} value mismatch: ` +
              `expected ${YGEnums[name]} (from YGEnums.mts), got ${Yoga[name]}`,
          )
        }
      }
      if (missing.length) {
        throw new Error(
          `Sync wrapper missing ${missing.length} enum constants: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`,
        )
      }
    },
  }
}

/**
 * Parse JavaScript/ESM code into AST.
 *
 * @param {string} code - Source code to parse
 * @param {boolean} isModule - Whether to parse as ES module
 * @returns {object} AST
 */
function parseCode(code, isModule = true) {
  return acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: isModule ? 'module' : 'script',
  })
}

/**
 * Transform ESM module for inlining by removing imports and exports.
 *
 * @param {string} code - Source code
 * @param {object} options - Transform options
 * @param {boolean} options.removeImports - Remove import declarations
 * @param {boolean} options.convertDefaultExport - Convert default export to variable
 * @param {string} options.defaultExportName - Name for converted default export variable
 * @param {boolean} options.removeDefaultExport - Remove default export entirely
 * @param {boolean} options.convertExportConst - Convert 'export const' to 'const'
 * @returns {string} Transformed code
 */
function transformEsmForInlining(code, options = {}) {
  const {
    convertDefaultExport = false,
    convertExportConst = false,
    defaultExportName = undefined,
    removeDefaultExport = false,
    removeImports = true,
  } = options

  const ast = parseCode(code, true)
  const s = new MagicString(code)

  walk.simple(ast, {
    ExportDefaultDeclaration(node) {
      if (removeDefaultExport) {
        // Remove entire export default statement.
        s.remove(node.start, node.end)
      } else if (convertDefaultExport && defaultExportName) {
        // Convert 'export default X' to 'const defaultExportName = X;'
        // or 'export default function X' to 'function X'
        const declType = node.declaration.type
        if (declType === 'FunctionDeclaration') {
          // export default function foo() {} -> function foo() {}
          s.overwrite(node.start, node.declaration.start, '')
        } else if (declType === 'Identifier') {
          // export default constants -> const YGEnums = constants;
          s.overwrite(
            node.start,
            node.end,
            `const ${defaultExportName} = ${node.declaration.name};`,
          )
        } else {
          // Unsupported export default types - fail explicitly rather than silently
          const supportedTypes = ['FunctionDeclaration', 'Identifier']
          throw new Error(
            `Unsupported export default type: ${declType}. ` +
              `Only ${supportedTypes.join(', ')} are supported. ` +
              `If upstream Yoga changed export style, update transformEsmForInlining().`,
          )
        }
      }
    },
    ExportNamedDeclaration(node) {
      if (convertExportConst && node.declaration) {
        // Convert 'export const X' to 'const X'.
        const exportKeyword = code.slice(node.start, node.declaration.start)
        if (exportKeyword.includes('export')) {
          s.overwrite(node.start, node.declaration.start, '')
        }
      }
    },
    ImportDeclaration(node) {
      if (removeImports) {
        // Remove import statement entirely.
        s.remove(node.start, node.end)
      }
    },
  })

  return s.toString()
}

/**
 * Find and replace the default export in generated wrapper.
 *
 * @param {string} code - Wrapper code
 * @param {string} replacement - Replacement code
 * @param {boolean} isEsm - Whether ESM or CJS
 * @returns {string} Modified code
 */
function replaceWrapperExport(code, replacement, isEsm) {
  const ast = parseCode(code, isEsm)
  const s = new MagicString(code)
  let replaced = false

  if (isEsm) {
    // Find: export default yogaModule;
    walk.simple(ast, {
      ExportDefaultDeclaration(node) {
        if (
          node.declaration.type === 'Identifier' &&
          node.declaration.name.endsWith('Module')
        ) {
          s.overwrite(node.start, node.end, replacement)
          replaced = true
        }
      },
    })
  } else {
    // Find: module.exports = yogaModule;
    walk.simple(ast, {
      ExpressionStatement(node) {
        if (
          node.expression.type === 'AssignmentExpression' &&
          node.expression.left.type === 'MemberExpression' &&
          node.expression.left.object.name === 'module' &&
          node.expression.left.property.name === 'exports' &&
          node.expression.right.type === 'Identifier' &&
          node.expression.right.name.endsWith('Module')
        ) {
          s.overwrite(node.start, node.end, replacement)
          replaced = true
        }
      },
    })
  }

  if (!replaced) {
    throw new Error(
      `Failed to find ${isEsm ? 'export default' : 'module.exports'} in wrapper`,
    )
  }

  return s.toString()
}

/**
 * Post-process ESM wrapper to include wrapAssembly.
 */
async function postProcessEsmWrapper(
  syncEsmFile,
  ygEnumsContent,
  wrapAssemblyContent,
) {
  let content = await fs.readFile(syncEsmFile, 'utf8')

  // Transform YGEnums: remove imports, convert default export to alias.
  const ygEnumsInlined = transformEsmForInlining(ygEnumsContent, {
    convertDefaultExport: true,
    defaultExportName: 'YGEnums',
    removeImports: true,
  })

  // Transform wrapAssembly: remove imports, keep function (remove export default).
  const wrapAssemblyInlined = transformEsmForInlining(wrapAssemblyContent, {
    convertDefaultExport: true,
    // Function name is preserved, just remove 'export default'.
    defaultExportName: 'wrapAssembly',
    removeImports: true,
  })

  // Build replacement code.
  const replacement = `// ============================================
// Inlined YGEnums.mts
// ============================================
${ygEnumsInlined}

// ============================================
// Inlined wrapAssembly.mts
// ============================================
${wrapAssemblyInlined}

// Apply wrapper to get official yoga-layout API.
const Yoga = wrapAssembly(yogaModule);

// ESM export - wrapped Yoga with official API.
export default Yoga;`

  // Replace the export default yogaModule; with our wrapped version.
  content = replaceWrapperExport(content, replacement, true)

  await fs.writeFile(syncEsmFile, content, 'utf8')
  logger.substep('ESM wrapper post-processed with wrapAssembly')
}

/**
 * Post-process CJS wrapper to include wrapAssembly.
 */
async function postProcessCjsWrapper(
  syncCjsFile,
  ygEnumsContent,
  wrapAssemblyContent,
) {
  let content = await fs.readFile(syncCjsFile, 'utf8')

  // Transform YGEnums for CJS: remove imports, convert exports, alias default export.
  // This reuses the existing 'constants' object from YGEnums.mts instead of duplicating it.
  const ygEnumsCjs = transformEsmForInlining(ygEnumsContent, {
    convertDefaultExport: true,
    convertExportConst: true,
    // Alias 'constants' as 'YGEnums' for wrapAssembly compatibility.
    defaultExportName: 'YGEnums',
    removeImports: true,
  })

  // Transform wrapAssembly for CJS: remove imports, convert export default function.
  const wrapAssemblyCjs = transformEsmForInlining(wrapAssemblyContent, {
    convertDefaultExport: true,
    defaultExportName: 'wrapAssembly',
    removeImports: true,
  })

  // Build replacement code - no duplication, reuses constants object.
  const replacement = `// ============================================
// Inlined YGEnums (CJS)
// ============================================
${ygEnumsCjs}

// ============================================
// Inlined wrapAssembly (CJS)
// ============================================
${wrapAssemblyCjs}

// Apply wrapper to get official yoga-layout API.
var _yoga = wrapAssembly(yogaModule);
module.exports = _yoga;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Align: 0, BoxSizing: 0, Config: 0, Dimension: 0, Direction: 0, Display: 0,
  Edge: 0, Errata: 0, ExperimentalFeature: 0, FlexDirection: 0, Gutter: 0,
  Justify: 0, LogLevel: 0, MeasureMode: 0, Node: 0, NodeType: 0, Overflow: 0,
  PositionType: 0, Unit: 0, Wrap: 0
});`

  // Replace the module.exports = yogaModule; with our wrapped version.
  content = replaceWrapperExport(content, replacement, false)

  await fs.writeFile(syncCjsFile, content, 'utf8')
  logger.substep('CJS wrapper post-processed with wrapAssembly')
}
