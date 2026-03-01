/**
 * Common AST transformations for both CJS and ESM sync wrappers.
 *
 * Applies transformations that are shared between CommonJS and ESM:
 * - Remove export/import statements
 * - Remove async/await keywords
 * - Transform WebAssembly.instantiate to synchronous WebAssembly.Instance
 * - Clean up Promise patterns
 * - Handle Node.js module patterns
 */

import { builtinModules } from 'node:module'

import { Parser } from 'acorn'
import { ancestor, simple as walkSimple } from 'acorn-walk'
import MagicString from 'magic-string'

// Set of Node.js built-in modules
const builtinModulesSet = new Set(builtinModules)

/**
 * Apply common transformations to MJS content.
 *
 * @param {object} options - Transform options
 * @param {string} options.mjsContent - MJS content to transform
 * @param {string} options.initFunctionName - Init function name
 * @param {string} options.exportName - Export name
 * @param {object} options.logger - Logger instance
 * @returns {Promise<string>} Transformed content
 */
export async function applyCommonTransforms(options) {
  const {
    exportName,
    initFunctionName,
    logger,
    mjsContent: inputContent,
  } = options

  let mjsContent = inputContent

  // === PASS 2: Main transformations ===
  const ast = Parser.parse(mjsContent, {
    ecmaVersion: 'latest',
    sourceType: 'module',
  })
  const s = new MagicString(mjsContent)

  // Helpers: Safe transformations for minified code (may have overlapping mods)
  const safeOverwrite = (start, end, content) => {
    try {
      s.overwrite(start, end, content)
    } catch {
      // Minified code - skip conflicting overwrites
    }
  }

  const safeRemove = (start, end) => {
    try {
      s.remove(start, end)
    } catch {
      // Minified code - skip conflicting removes, leave as dead code
    }
  }

  // Aggressively convert from ESM/async to sync
  // This handles:
  // 1. Remove all export statements (ESM → no exports in wrapper)
  // 2. Remove all import statements (not needed in embedded context)
  // 3. Remove async keyword from all function declarations
  // 4. Remove ALL await expressions (top-level and nested)
  // 5. Remove top-level statements that fetch/load WASM asynchronously

  const topLevelStatementsToRemove = []
  const requireDeclaratorsToRemove = []
  const returnModuleToFix = []
  // Track functions that need WebAssembly.instantiate replacement
  const functionsToGut = []
  let exportDefaultIndex = -1

  ancestor(ast, {
    // Remove ALL export statements
    ExportDefaultDeclaration(node, ancestors) {
      const parent = ancestors[ancestors.length - 2]
      if (parent?.type === 'Program') {
        // Find the index of this export in the program body
        const programBody = parent.body
        exportDefaultIndex = programBody.indexOf(node)

        // If exporting a function declaration, keep the function but remove "export default"
        if (node.declaration?.type === 'FunctionDeclaration') {
          // Remove "export default" keywords only, keep the function declaration
          safeRemove(node.start, node.declaration.start)
        } else {
          // For other default exports (expressions, etc), remove entirely
          safeRemove(node.start, node.end)
        }

        // Mark all statements after the export for removal (pthread initialization code)
        for (let i = exportDefaultIndex + 1; i < programBody.length; i++) {
          topLevelStatementsToRemove.push(programBody[i])
        }
      }
    },
    ExportNamedDeclaration(node, ancestors) {
      const parent = ancestors[ancestors.length - 2]
      if (parent?.type === 'Program') {
        if (node.declaration) {
          // Remove "export" keyword only: "export const foo" → "const foo"
          safeRemove(node.start, node.declaration.start)
        } else {
          // Remove entire statement: export { ... };
          safeRemove(node.start, node.end)
        }
      }
    },
    // Remove ALL import statements (not needed with embedded WASM)
    ImportDeclaration(node, ancestors) {
      const parent = ancestors[ancestors.length - 2]
      if (parent?.type === 'Program') {
        safeRemove(node.start, node.end)
      }
    },
    // Remove findWasmBinary function - we have embedded wasmBinary
    FunctionDeclaration(node) {
      if (node.id?.name === 'findWasmBinary') {
        safeRemove(node.start, node.end)
        return
      }

      // Track WebAssembly instantiation helper functions for later gutting (but NOT the main Module function)
      const funcName = node.id?.name

      // Detect WASM instantiation wrapper by behavior using AST traversal:
      // Target: Async wrapper functions that call WebAssembly.instantiate/instantiateStreaming
      // Characteristics that make these functions unique:
      // 1. Contains WebAssembly.instantiate (async APIs we're replacing)
      // 2. Contains wasmBinary or fetch (loads WASM binary)
      // 3. Does NOT already use 'new WebAssembly.Instance' (already sync, skip it!)
      // 4. NOT the main Module/init function (those call the wrapper)

      let hasAsyncWebAssemblyCall = false
      let hasLoadingMechanism = false
      let isNotAlreadySync = true

      // Use AST traversal to detect patterns - traverse the function body
      walkSimple(node, {
        CallExpression(callNode) {
          const callee = callNode.callee

          // Check for WebAssembly.instantiate/instantiateStreaming
          if (
            callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier' &&
            callee.object.name === 'WebAssembly' &&
            callee.property.type === 'Identifier' &&
            (callee.property.name === 'instantiate' ||
              callee.property.name === 'instantiateStreaming')
          ) {
            hasAsyncWebAssemblyCall = true
          }

          // Check for fetch calls
          if (callee.type === 'Identifier' && callee.name === 'fetch') {
            hasLoadingMechanism = true
          }
        },
        NewExpression(newNode) {
          // Check for new WebAssembly.Instance (already sync)
          const callee = newNode.callee
          if (
            callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier' &&
            callee.object.name === 'WebAssembly' &&
            callee.property.type === 'Identifier' &&
            callee.property.name === 'Instance'
          ) {
            isNotAlreadySync = false
          }
        },
        Identifier(idNode) {
          // Check for wasmBinary identifier
          if (idNode.name === 'wasmBinary') {
            hasLoadingMechanism = true
          }
        },
      })

      const isNotMainFunction =
        funcName !== 'Module' &&
        funcName !== initFunctionName &&
        funcName !== exportName

      // Remove async keyword from ALL async functions (including Module)
      if (node.async) {
        const asyncPos = mjsContent.indexOf('async', node.start)
        if (asyncPos >= 0 && asyncPos < node.body.start) {
          // Remove "async " (6 characters including space)
          safeRemove(asyncPos, asyncPos + 6)
        }
      }

      // Mark helper functions for gutting in Pass 3 (but NOT the main Module function)
      if (
        hasAsyncWebAssemblyCall &&
        hasLoadingMechanism &&
        isNotAlreadySync &&
        isNotMainFunction
      ) {
        functionsToGut.push(funcName || '(anonymous)')
      }
    },
    FunctionExpression(node) {
      if (node.async) {
        const pos = mjsContent.indexOf('async', node.start)
        if (pos >= 0 && pos < node.start + 20) {
          safeRemove(pos, pos + 6)
        }
      }
    },
    ArrowFunctionExpression(node) {
      if (node.async) {
        const pos = mjsContent.indexOf('async', node.start)
        if (pos >= 0 && pos < node.start + 20) {
          safeRemove(pos, pos + 6)
        }
      }
    },
    // Remove await keyword
    AwaitExpression(node) {
      const pos = mjsContent.indexOf('await', node.start)
      if (pos >= 0 && pos < node.start + 10) {
        safeRemove(pos, pos + 6)
      }
    },
    // Handle optional call expressions: readyPromiseResolve?.(Module)
    ChainExpression(node) {
      // In Acorn, optional calls are wrapped in ChainExpression
      const expr = node.expression
      if (
        expr?.type === 'CallExpression' &&
        expr.callee?.type === 'Identifier' &&
        expr.callee?.name === 'readyPromiseResolve' &&
        expr.arguments?.length === 1
      ) {
        const arg = mjsContent.slice(
          expr.arguments[0].start,
          expr.arguments[0].end,
        )
        safeOverwrite(node.start, node.end, `(moduleRtn = ${arg})`)
        return
      }
    },
    CallExpression(node, ancestors) {
      const parent = ancestors[ancestors.length - 2]

      // Remove .catch() calls since we're making everything synchronous
      if (
        node.callee?.type === 'MemberExpression' &&
        node.callee?.property?.name === 'catch'
      ) {
        // Remove the .catch(...) part, keeping just the object
        safeRemove(node.callee.property.start - 1, node.end)
        return
      }

      // Replace promise resolve calls with direct assignment: moduleRtn = Module
      // Handles: fa(D) where fa is from ia=new Promise((a,b)=>{fa=a;ha=b})
      if (
        node.callee?.type === 'Identifier' &&
        node.callee?.name === 'fa' &&
        node.arguments?.length === 1
      ) {
        const arg = mjsContent.slice(
          node.arguments[0].start,
          node.arguments[0].end,
        )
        safeOverwrite(node.start, node.end, `(moduleRtn = ${arg})`)
        return
      }

      // 0. Replace findWasmBinary() calls with empty string
      // We have wasmBinary embedded, so we don't need to locate the file
      if (node.callee?.name === 'findWasmBinary') {
        safeOverwrite(node.start, node.end, "''")
        return
      }

      // 1. Handle require("url").fileURLToPath(...) patterns FIRST
      // This must come before the built-in module prefix handler
      // Pattern: require("url").fileURLToPath(import.meta.url) or require("url").fileURLToPath(__filename)
      // Pattern: require("url").fileURLToPath(new URL("./", __filename)) -> __dirname
      if (
        node.callee?.type === 'MemberExpression' &&
        node.callee?.property?.name === 'fileURLToPath' &&
        node.callee?.object?.type === 'CallExpression' &&
        node.callee?.object?.callee?.name === 'require' &&
        (node.callee?.object?.arguments?.[0]?.value === 'url' ||
          node.callee?.object?.arguments?.[0]?.value === 'node:url')
      ) {
        const arg = node.arguments?.[0]
        // Check if the argument is __filename, __importMetaUrl, or import.meta.url
        const isFilename =
          arg?.type === 'Identifier' && arg.name === '__filename'
        const isImportMetaUrl =
          (arg?.type === 'Identifier' && arg.name === '__importMetaUrl') ||
          (arg?.type === 'MemberExpression' &&
            arg.object?.type === 'MetaProperty' &&
            arg.object?.meta?.name === 'import' &&
            arg.object?.property?.name === 'meta' &&
            arg.property?.name === 'url')
        // Check for new URL("./", __filename), new URL("./", __importMetaUrl), or new URL("./", import.meta.url) pattern
        const isNewURLWithFilename =
          arg?.type === 'NewExpression' &&
          arg.callee?.name === 'URL' &&
          arg.arguments?.length === 2 &&
          (arg.arguments[0]?.type === 'StringLiteral' ||
            arg.arguments[0]?.type === 'Literal') &&
          arg.arguments[0]?.value === './' &&
          arg.arguments[1]?.type === 'Identifier' &&
          arg.arguments[1]?.name === '__filename'
        const isNewURLWithImportMetaUrl =
          arg?.type === 'NewExpression' &&
          arg.callee?.name === 'URL' &&
          arg.arguments?.length === 2 &&
          (arg.arguments[0]?.type === 'StringLiteral' ||
            arg.arguments[0]?.type === 'Literal') &&
          arg.arguments[0]?.value === './' &&
          arg.arguments[1]?.type === 'Identifier' &&
          arg.arguments[1]?.name === '__importMetaUrl'
        const isNewURLWithImportMeta =
          arg?.type === 'NewExpression' &&
          arg.callee?.name === 'URL' &&
          arg.arguments?.length === 2 &&
          (arg.arguments[0]?.type === 'StringLiteral' ||
            arg.arguments[0]?.type === 'Literal') &&
          arg.arguments[0]?.value === './' &&
          arg.arguments[1]?.type === 'MemberExpression' &&
          arg.arguments[1]?.object?.type === 'MetaProperty' &&
          arg.arguments[1]?.object?.meta?.name === 'import' &&
          arg.arguments[1]?.object?.property?.name === 'meta' &&
          arg.arguments[1]?.property?.name === 'url'

        if (isFilename || isImportMetaUrl) {
          // Replace entire expression with __filename
          safeOverwrite(node.start, node.end, '__filename')
        } else if (
          isNewURLWithFilename ||
          isNewURLWithImportMetaUrl ||
          isNewURLWithImportMeta
        ) {
          // Replace require("url").fileURLToPath(new URL("./", __filename or __importMetaUrl or import.meta.url)) with __dirname
          safeOverwrite(node.start, node.end, '__dirname')
        }
        return
      }

      // 2. Handle standalone fileURLToPath(...) calls
      // Pattern: fileURLToPath(__filename)
      // Pattern: fileURLToPath(new URL("./", __filename or import.meta.url)) -> __dirname
      if (node.callee?.name === 'fileURLToPath') {
        const arg = node.arguments?.[0]
        const isFilename =
          arg?.type === 'Identifier' && arg.name === '__filename'
        // Check for new URL("./", __filename) or new URL("./", import.meta.url) pattern
        const isNewURLWithFilename =
          arg?.type === 'NewExpression' &&
          arg.callee?.name === 'URL' &&
          arg.arguments?.length === 2 &&
          (arg.arguments[0]?.type === 'StringLiteral' ||
            arg.arguments[0]?.type === 'Literal') &&
          arg.arguments[0]?.value === './' &&
          arg.arguments[1]?.type === 'Identifier' &&
          arg.arguments[1]?.name === '__filename'
        const isNewURLWithImportMetaUrl =
          arg?.type === 'NewExpression' &&
          arg.callee?.name === 'URL' &&
          arg.arguments?.length === 2 &&
          (arg.arguments[0]?.type === 'StringLiteral' ||
            arg.arguments[0]?.type === 'Literal') &&
          arg.arguments[0]?.value === './' &&
          arg.arguments[1]?.type === 'Identifier' &&
          arg.arguments[1]?.name === '__importMetaUrl'
        const isNewURLWithImportMeta =
          arg?.type === 'NewExpression' &&
          arg.callee?.name === 'URL' &&
          arg.arguments?.length === 2 &&
          (arg.arguments[0]?.type === 'StringLiteral' ||
            arg.arguments[0]?.type === 'Literal') &&
          arg.arguments[0]?.value === './' &&
          arg.arguments[1]?.type === 'MemberExpression' &&
          arg.arguments[1]?.object?.type === 'MetaProperty' &&
          arg.arguments[1]?.object?.meta?.name === 'import' &&
          arg.arguments[1]?.object?.property?.name === 'meta' &&
          arg.arguments[1]?.property?.name === 'url'

        if (isFilename) {
          // Replace fileURLToPath(__filename) with __filename
          safeOverwrite(node.start, node.end, '__filename')
        } else if (
          isNewURLWithFilename ||
          isNewURLWithImportMetaUrl ||
          isNewURLWithImportMeta
        ) {
          // Replace fileURLToPath(new URL("./", __filename or __importMetaUrl or import.meta.url)) with __dirname
          safeOverwrite(node.start, node.end, '__dirname')
        }
        return
      }

      // 3. Handle import() expressions
      if (
        node.callee?.type === 'ImportExpression' &&
        parent.type !== 'AwaitExpression'
      ) {
        // Check if this is createRequire pattern that should be removed
        // Pattern: const {createRequire:a}=import("module");var require=a(import.meta.url);
        if (
          node.arguments?.[0]?.value === 'module' &&
          parent.type === 'VariableDeclarator' &&
          parent.id?.type === 'ObjectPattern'
        ) {
          // This is the createRequire import - mark it for removal
          // Find the entire variable declaration by walking up ancestors
          let varDecl = null
          for (let i = ancestors.length - 1; i >= 0; i--) {
            if (ancestors[i].type === 'VariableDeclaration') {
              varDecl = ancestors[i]
              break
            }
          }
          const program = ancestors.find(n => n.type === 'Program')
          if (varDecl && program) {
            topLevelStatementsToRemove.push(varDecl)
          }
        } else {
          // Convert import("module") to require("module")
          // In Acorn, import() is parsed as CallExpression with callee type 'ImportExpression'
          // Replace the callee (which is the ImportExpression node)
          safeOverwrite(node.callee.start, node.callee.end, 'require')
        }
        return
      }

      // 4. Handle require() calls - add node: prefix for built-in modules
      // IMPORTANT: Skip if this require("url") is part of a .fileURLToPath() call
      // because we handle that pattern above by replacing the entire expression
      if (
        node.callee?.type === 'Identifier' &&
        node.callee?.name === 'require' &&
        node.arguments?.length === 1 &&
        (node.arguments[0]?.type === 'StringLiteral' ||
          node.arguments[0]?.type === 'Literal')
      ) {
        const moduleName = node.arguments[0].value

        // Skip if this is require("url") or require("node:url") followed by .fileURLToPath
        if (
          (moduleName === 'url' || moduleName === 'node:url') &&
          parent.type === 'MemberExpression' &&
          parent.property?.name === 'fileURLToPath'
        ) {
          // Don't transform - let the fileURLToPath handler deal with it
          return
        }

        // Check if it's a built-in module without node: prefix
        if (
          builtinModulesSet.has(moduleName) &&
          !moduleName.startsWith('node:')
        ) {
          // Replace "module" with "node:module"
          const argNode = node.arguments[0]
          safeOverwrite(argNode.start, argNode.end, `"node:${moduleName}"`)
        }
      }
    },
    // Handle const {createRequire} = require("module"); - remove entire statement
    VariableDeclaration(node) {
      // Check if this is a const declaration with createRequire destructuring
      if (
        node.kind === 'const' &&
        node.declarations?.length === 1 &&
        node.declarations[0]?.id?.type === 'ObjectPattern'
      ) {
        const properties = node.declarations[0].id.properties
        const hasCreateRequire = properties?.some(
          prop =>
            (prop.type === 'Property' || prop.type === 'ObjectProperty') &&
            (prop.key?.name === 'createRequire' ||
              prop.value?.name?.includes('createRequire') ||
              prop.key?.value === 'createRequire'),
        )

        if (hasCreateRequire) {
          // This is the createRequire import - mark entire statement for removal
          const init = node.declarations[0].init

          // Handle both patterns:
          // 1. Original: const {createRequire:a}=await import("module")
          // 2. Transformed: const {createRequire:a}=require("module")
          let shouldRemove = false
          let argValue = null

          // Check for await import("module") pattern
          // Note: import() is parsed as CallExpression with callee.type === 'ImportExpression'
          if (
            init?.type === 'AwaitExpression' &&
            init?.argument?.type === 'CallExpression' &&
            init?.argument?.callee?.type === 'ImportExpression'
          ) {
            argValue = init.argument.arguments?.[0]?.value
            shouldRemove = argValue === 'module'
          }
          // Check for require("module") pattern (already transformed)
          else if (
            init?.type === 'CallExpression' &&
            init?.callee?.name === 'require'
          ) {
            argValue = init?.arguments?.[0]?.value
            shouldRemove = argValue === 'module' || argValue === 'node:module'
          }

          if (shouldRemove) {
            // Remove the entire statement
            safeRemove(node.start, node.end)
          }
        }
      }

      // Keep wasmBinaryFile declarations - needed for synchronous WASM loading
    },
    // Handle var require = ... declarations that should be removed in CJS
    VariableDeclarator(node, ancestors) {
      const parent = ancestors[ancestors.length - 2]
      const isRequireDeclarator = node.id?.name === 'require'
      const parentIsVarDecl = parent?.type === 'VariableDeclaration'

      if (isRequireDeclarator && parentIsVarDecl) {
        // Mark this declarator for special handling
        requireDeclaratorsToRemove.push({
          node,
          varDecl: parent,
        })
      }

      // Simplify ENVIRONMENT_IS_NODE check - we're Node.js only
      // Pattern: var ENVIRONMENT_IS_NODE = globalThis.process?.versions?.node && globalThis.process?.type != 'renderer';
      if (
        node.id?.name === 'ENVIRONMENT_IS_NODE' &&
        node.init?.type === 'LogicalExpression'
      ) {
        // Replace the entire initialization with: true
        safeOverwrite(node.init.start, node.init.end, 'true')
      }

      // Replace Promise pattern: ia=new Promise((a,b)=>{fa=a;ha=b})
      // This Promise wraps the module but we're making everything synchronous
      // Just remove it - we'll handle moduleRtn assignment directly
      if (
        node.init?.type === 'NewExpression' &&
        node.init.callee?.name === 'Promise' &&
        node.init.arguments?.[0]?.type === 'ArrowFunctionExpression'
      ) {
        // Check if this is the module promise pattern by looking for the resolve/reject params
        const arrowFn = node.init.arguments[0]
        if (arrowFn.params?.length === 2) {
          // Replace with null - we'll assign the actual module later when we see fa(D)
          safeOverwrite(node.init.start, node.init.end, 'null')
        }
      }
    },
    // Handle moduleRtn = ia assignment
    AssignmentExpression(node, ancestors) {
      const parent = ancestors[ancestors.length - 2]
      // Replace moduleRtn = ia with nothing (remove it)
      // We're already setting moduleRtn directly via fa(D) -> (moduleRtn = D)
      if (
        node.left?.type === 'Identifier' &&
        node.left?.name === 'moduleRtn' &&
        node.right?.type === 'Identifier' &&
        node.right?.name === 'ia' &&
        parent?.type === 'ExpressionStatement'
      ) {
        // Remove the entire expression statement
        safeRemove(parent.start, parent.end + 1)
      }
    },
    // Replace return moduleRtn with return <actual_module>
    // The actual module is either 'D' (ONNX) or 'Module' (Yoga)
    ReturnStatement(node, ancestors) {
      if (
        node.argument?.type === 'Identifier' &&
        node.argument?.name === 'moduleRtn'
      ) {
        // Determine which module variable to use by checking the function name
        // Yoga: async function Module(moduleArg) - named function uses 'Module'
        // ONNX: async function(moduleArg) - anonymous function uses 'D'
        // Default to ONNX pattern
        let moduleVar = 'D'

        // Walk up ancestors to find the function declaration/expression
        for (let i = ancestors.length - 1; i >= 0; i--) {
          const ancestor = ancestors[i]
          if (
            ancestor.type === 'FunctionDeclaration' ||
            ancestor.type === 'FunctionExpression'
          ) {
            // Check if the function is named 'Module' (Yoga pattern)
            if (ancestor.id?.name === 'Module') {
              moduleVar = 'Module'
            }
            break
          }
        }

        safeOverwrite(node.argument.start, node.argument.end, moduleVar)
      }

      // Handle 'return Module' at the end of the Module function
      // This should be 'return moduleRtn' instead
      // Collect these for a second pass to avoid split point conflicts
      if (
        node.argument?.type === 'Identifier' &&
        node.argument?.name === 'Module'
      ) {
        // Walk up ancestors to find the function declaration
        for (let i = ancestors.length - 1; i >= 0; i--) {
          const ancestor = ancestors[i]
          if (ancestor.type === 'FunctionDeclaration') {
            // Check if we're inside the Module function
            if (ancestor.id?.name === 'Module') {
              // Collect for second pass
              returnModuleToFix.push({
                start: node.argument.start,
                end: node.argument.end,
              })
            }
            break
          }
        }
      }
    },
  })

  // Handle require declarators - remove them from their variable declarations
  for (const { node: declaratorNode, varDecl } of requireDeclaratorsToRemove) {
    const declarators = varDecl.declarations
    const index = declarators.indexOf(declaratorNode)

    if (declarators.length === 1) {
      // Only one declarator - remove entire statement
      safeRemove(varDecl.start, varDecl.end)
    } else if (index === 0) {
      // First declarator in a list - remove it and the following comma
      const nextDeclarator = declarators[1]
      // Find comma between declarators
      const textBetween = s.original.slice(
        declaratorNode.end,
        nextDeclarator.start,
      )
      const commaIndex = textBetween.indexOf(',')
      if (commaIndex >= 0) {
        safeRemove(declaratorNode.start, declaratorNode.end + commaIndex + 1)
      } else {
        safeRemove(declaratorNode.start, nextDeclarator.start)
      }
    } else {
      // Not first declarator - remove from previous comma to this declarator
      const prevDeclarator = declarators[index - 1]
      const textBetween = s.original.slice(
        prevDeclarator.end,
        declaratorNode.start,
      )
      const commaIndex = textBetween.lastIndexOf(',')
      if (commaIndex >= 0) {
        safeRemove(prevDeclarator.end + commaIndex, declaratorNode.end)
      } else {
        safeRemove(prevDeclarator.end, declaratorNode.end)
      }
    }
  }

  // Remove all top-level statements containing await
  for (const node of topLevelStatementsToRemove) {
    safeRemove(node.start, node.end)
  }

  mjsContent = s.toString()

  // Second pass: Re-parse and fix 'return Module' statements to avoid split point conflicts
  // Always do this pass since safeOverwrite may have failed silently in minified code
  const ast2 = Parser.parse(mjsContent, {
    ecmaVersion: 'latest',
    sourceType: 'module',
  })
  const s2 = new MagicString(mjsContent)
  let foundReturnModule = false

  ancestor(ast2, {
    ReturnStatement(node, ancestors) {
      if (
        node.argument?.type === 'Identifier' &&
        node.argument?.name === 'Module'
      ) {
        // Walk up ancestors to find the function declaration
        for (let i = ancestors.length - 1; i >= 0; i--) {
          const ancestor = ancestors[i]
          if (ancestor.type === 'FunctionDeclaration') {
            // Check if we're inside the Module function
            if (ancestor.id?.name === 'Module') {
              s2.overwrite(node.argument.start, node.argument.end, 'moduleRtn')
              foundReturnModule = true
            }
            break
          }
        }
      }
    },
  })

  if (foundReturnModule) {
    mjsContent = s2.toString()
  }

  // Pass 3: Gut WebAssembly.instantiate functions with fresh MagicString (avoid split point conflicts)
  if (functionsToGut.length > 0) {
    const ast3 = Parser.parse(mjsContent, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    })
    const s3 = new MagicString(mjsContent)
    let guttedCount = 0

    ancestor(ast3, {
      FunctionDeclaration(node) {
        const funcName = node.id?.name

        // Find functions containing WebAssembly.instantiate (same criteria as Pass 2)
        // IMPORTANT: Must match Pass 2 detection logic exactly!
        // Target: Async wrapper functions that call WebAssembly.instantiate/instantiateStreaming
        // Use AST traversal instead of string matching

        let hasAsyncWebAssemblyCall = false
        let hasLoadingMechanism = false
        let isNotAlreadySync = true

        // Use AST traversal to detect patterns
        walkSimple(node, {
          CallExpression(callNode) {
            const callee = callNode.callee

            // Check for WebAssembly.instantiate/instantiateStreaming
            if (
              callee.type === 'MemberExpression' &&
              callee.object.type === 'Identifier' &&
              callee.object.name === 'WebAssembly' &&
              callee.property.type === 'Identifier' &&
              (callee.property.name === 'instantiate' ||
                callee.property.name === 'instantiateStreaming')
            ) {
              hasAsyncWebAssemblyCall = true
            }

            // Check for fetch calls
            if (callee.type === 'Identifier' && callee.name === 'fetch') {
              hasLoadingMechanism = true
            }
          },
          NewExpression(newNode) {
            // Check for new WebAssembly.Instance (already sync)
            const callee = newNode.callee
            if (
              callee.type === 'MemberExpression' &&
              callee.object.type === 'Identifier' &&
              callee.object.name === 'WebAssembly' &&
              callee.property.type === 'Identifier' &&
              callee.property.name === 'Instance'
            ) {
              isNotAlreadySync = false
            }
          },
          Identifier(idNode) {
            // Check for wasmBinary identifier
            if (idNode.name === 'wasmBinary') {
              hasLoadingMechanism = true
            }
          },
        })

        const isNotMainFunction =
          funcName !== 'Module' &&
          funcName !== initFunctionName &&
          funcName !== exportName

        if (
          hasAsyncWebAssemblyCall &&
          hasLoadingMechanism &&
          isNotAlreadySync &&
          isNotMainFunction
        ) {
          // Extract param names
          const paramNames = node.params.map(param =>
            param.type === 'AssignmentPattern' ? param.left.name : param.name,
          )

          // Smart imports detection using AST traversal
          let importsParam = paramNames[0] || 'imports'
          let importsSetup = ''

          // Strategy 1: Use Acorn to traverse the function body and find WebAssembly.instantiate calls
          // This is much more reliable than regex for minified code
          const paramCounts = {}
          let foundInstantiate = false

          walkSimple(node, {
            CallExpression(callNode) {
              const callee = callNode.callee

              // Check for WebAssembly.instantiate or WebAssembly.instantiateStreaming
              if (
                callee.type === 'MemberExpression' &&
                callee.object.type === 'Identifier' &&
                callee.object.name === 'WebAssembly' &&
                callee.property.type === 'Identifier' &&
                (callee.property.name === 'instantiate' ||
                  callee.property.name === 'instantiateStreaming')
              ) {
                // The second argument is the imports object
                const importsArg = callNode.arguments[1]
                if (importsArg && importsArg.type === 'Identifier') {
                  const argName = importsArg.name
                  if (paramNames.includes(argName)) {
                    paramCounts[argName] = (paramCounts[argName] || 0) + 1
                    foundInstantiate = true
                  }
                }
              }
            },
          })

          // Use the parameter that appears most frequently
          const paramEntries = Object.entries(paramCounts)
          if (paramEntries.length > 0) {
            const sortedParams = paramEntries.sort(([, a], [, b]) => b - a)
            importsParam = sortedParams[0][0]
          }

          // Strategy 2: Look for variable declarations in the function body that construct imports
          if (!foundInstantiate) {
            const bodyStatements = node.body.body
            for (const stmt of bodyStatements) {
              if (stmt.type === 'VariableDeclaration') {
                for (const decl of stmt.declarations) {
                  const varName = decl.id?.name
                  if (!varName) {
                    continue
                  }

                  // Look for object literal declarations using AST
                  if (decl.init?.type === 'ObjectExpression') {
                    // This looks like an imports object
                    // Extract the full statement using source positions
                    const stmtCode = mjsContent.slice(stmt.start, stmt.end)
                    importsSetup = stmtCode.endsWith(';')
                      ? stmtCode
                      : `${stmtCode};`
                    importsParam = varName
                    break
                  }

                  // Look for CallExpression or other complex initializers
                  if (
                    decl.init &&
                    (decl.init.type === 'CallExpression' ||
                      decl.init.type === 'NewExpression')
                  ) {
                    // This could be building an imports object
                    const stmtCode = mjsContent.slice(stmt.start, stmt.end)
                    importsSetup = stmtCode.endsWith(';')
                      ? stmtCode
                      : `${stmtCode};`
                    importsParam = varName
                    break
                  }
                }
                if (importsSetup) {
                  break
                }
              }
            }
          }

          // Strategy 3: Fallback - if we couldn't find anything, use first parameter or create default
          if (!foundInstantiate && !importsSetup && paramNames.length === 0) {
            importsParam = 'info'
            importsSetup = 'var info={};'
          }

          s3.overwrite(
            node.body.start + 1,
            node.body.end - 1,
            `\n  ${importsSetup}var module=new WebAssembly.Module(wasmBinary);var instance=new WebAssembly.Instance(module,${importsParam});return {instance:instance,module:module};\n`,
          )
          guttedCount++
          logger.substep(
            `Gutted WebAssembly.instantiate function: ${funcName || '(anonymous)'} (using imports: ${importsParam})`,
          )
        }
      },
    })

    if (guttedCount > 0) {
      mjsContent = s3.toString()
      logger.substep(
        `Gutted ${guttedCount} WebAssembly.instantiate function(s)`,
      )
    } else if (functionsToGut.length > 0) {
      logger.warn(
        `Expected to gut ${functionsToGut.length} function(s) but found ${guttedCount}`,
      )
    }
  }

  return mjsContent
}
