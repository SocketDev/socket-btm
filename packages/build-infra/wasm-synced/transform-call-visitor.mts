/**
 * Pass-2 visitor handlers for call/variable/return nodes.
 *
 * Covers: CallExpression, VariableDeclaration, VariableDeclarator,
 * AssignmentExpression, ReturnStatement.
 *
 * Split from transform.mts to keep each file under the 500-line soft cap.
 */

import { builtinModules } from 'node:module'

const builtinModulesSet = new Set(builtinModules)

/**
 * Build the call/variable/return visitor handlers for the ancestor walk.
 *
 * @param {object} options - Visitor context.
 * @param {string} options.detectedModuleVar - Detected Emscripten module
 *   variable name.
 * @param {string} options.mjsContent - Source content (read-only during pass).
 * @param {Function} options.safeOverwrite - Safe overwrite helper.
 * @param {Function} options.safeRemove - Safe remove helper.
 * @param {Array} options.requireDeclaratorsToRemove - Collector array.
 * @param {Array} options.returnModuleToFix - Collector array.
 * @param {Array} options.topLevelStatementsToRemove - Collector array.
 *
 * @returns {object} Visitor handlers object for acorn-walk ancestor().
 */
export function buildCallVisitor(options) {
  const {
    detectedModuleVar,
    mjsContent,
    requireDeclaratorsToRemove,
    returnModuleToFix,
    safeOverwrite,
    safeRemove,
    topLevelStatementsToRemove,
  } = { __proto__: null, ...options } as typeof options

  return {
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
          isNewURLWithImportMeta ||
          isNewURLWithImportMetaUrl
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
          isNewURLWithImportMeta ||
          isNewURLWithImportMetaUrl
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
          let varDecl
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
          (moduleName === 'node:url' || moduleName === 'url') &&
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
        const { properties } = node.declarations[0].id
        const hasCreateRequire = properties?.some(
          prop =>
            (prop.type === 'ObjectProperty' || prop.type === 'Property') &&
            (prop.key?.name === 'createRequire' ||
              prop.value?.name?.includes('createRequire') ||
              prop.key?.value === 'createRequire'),
        )

        if (hasCreateRequire) {
          // This is the createRequire import - mark entire statement for removal
          const { init } = node.declarations[0]

          // Handle both patterns:
          // 1. Original: const {createRequire:a}=await import("module")
          // 2. Transformed: const {createRequire:a}=require("module")
          let shouldRemove = false
          let argValue

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
    // The actual module is either 'D' (legacy ONNX), 'Module' (Yoga),
    // or whatever variable the newer minifier assigned moduleArg to
    // (e.g. 'n' in recent onnx builds). When hardcoded to 'D' against
    // a newer build, `return D` returns the HEAP8 Int8Array alias.
    ReturnStatement(node, ancestors) {
      if (
        node.argument?.type === 'Identifier' &&
        node.argument?.name === 'moduleRtn'
      ) {
        // Prefer a real detected module identifier; otherwise fall back
        // to the ancestor-name heuristic from the original transform.
        let moduleVar = detectedModuleVar || 'D'

        // Walk up ancestors to find the function declaration/expression
        for (let i = ancestors.length - 1; i >= 0; i--) {
          const frame = ancestors[i]
          if (
            frame.type === 'FunctionDeclaration' ||
            frame.type === 'FunctionExpression'
          ) {
            // Check if the function is named 'Module' (Yoga pattern)
            if (frame.id?.name === 'Module') {
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
          const frame = ancestors[i]
          if (frame.type === 'FunctionDeclaration') {
            // Check if we're inside the Module function
            if (frame.id?.name === 'Module') {
              // Collect for second pass
              returnModuleToFix.push({
                end: node.argument.end,
                start: node.argument.start,
              })
            }
            break
          }
        }
      }
    },
  }
}
