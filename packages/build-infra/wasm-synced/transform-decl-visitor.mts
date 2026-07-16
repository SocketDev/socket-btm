/**
 * Pass-2 visitor handlers for declaration/function/async nodes.
 *
 * Covers: ExportDefaultDeclaration, ExportNamedDeclaration, ImportDeclaration,
 * FunctionDeclaration, FunctionExpression, ArrowFunctionExpression,
 * AwaitExpression, ChainExpression.
 *
 * Split from transform.mts to keep each file under the 500-line soft cap.
 */

import { simple as walkSimple } from 'acorn-walk'

/**
 * Build the declaration/function/async visitor handlers for the ancestor walk.
 *
 * @param {object} options - Visitor context.
 * @param {string} options.exportName - Export name.
 * @param {string} options.initFunctionName - Init function name.
 * @param {string} options.mjsContent - Source content (read-only during pass).
 * @param {Function} options.safeOverwrite - Safe overwrite helper.
 * @param {Function} options.safeRemove - Safe remove helper.
 * @param {Array} options.topLevelStatementsToRemove - Collector array.
 * @param {Array} options.functionsToGut - Collector array.
 *
 * @returns {object} Visitor handlers object for acorn-walk ancestor().
 */
export function buildDeclVisitor(options) {
  const {
    exportName,
    functionsToGut,
    initFunctionName,
    mjsContent,
    safeOverwrite,
    safeRemove,
    topLevelStatementsToRemove,
  } = { __proto__: null, ...options } as typeof options

  return {
    // Remove ALL export statements
    ExportDefaultDeclaration(node, ancestors) {
      const parent = ancestors[ancestors.length - 2]
      if (parent?.type === 'Program') {
        // Find the index of this export in the program body
        const programBody = parent.body
        const exportDefaultIndex = programBody.indexOf(node)

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
        Identifier(idNode) {
          // Check for wasmBinary identifier
          if (idNode.name === 'wasmBinary') {
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
      })

      const isNotMainFunction =
        funcName !== 'Module' &&
        funcName !== initFunctionName &&
        funcName !== exportName

      // Remove async keyword from ALL async functions (including Module)
      if (node.async) {
        const asyncPos = mjsContent.indexOf('async', node.start)
        if (asyncPos !== -1 && asyncPos < node.body.start) {
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
        if (pos !== -1 && pos < node.start + 20) {
          // Remove the 5-char "async" keyword. If a trailing space
          // follows (e.g. "async foo" or "async ()=>"), also eat that
          // space. But NEVER consume the next non-space char: minified
          // code sometimes writes `async()=>` with no space, and the
          // old `pos + 6` stripped the opening paren along with
          // "async" — producing `=>{...})` parse errors downstream.
          const end =
            pos + 5 + (mjsContent.charCodeAt(pos + 5) === 0x20 ? 1 : 0)
          safeRemove(pos, end)
        }
      }
    },
    ArrowFunctionExpression(node) {
      if (node.async) {
        const pos = mjsContent.indexOf('async', node.start)
        if (pos !== -1 && pos < node.start + 20) {
          // Remove the 5-char "async" keyword. If a trailing space
          // follows (e.g. "async foo" or "async ()=>"), also eat that
          // space. But NEVER consume the next non-space char: minified
          // code sometimes writes `async()=>` with no space, and the
          // old `pos + 6` stripped the opening paren along with
          // "async" — producing `=>{...})` parse errors downstream.
          const end =
            pos + 5 + (mjsContent.charCodeAt(pos + 5) === 0x20 ? 1 : 0)
          safeRemove(pos, end)
        }
      }
    },
    // Remove await keyword
    AwaitExpression(node) {
      const pos = mjsContent.indexOf('await', node.start)
      if (pos !== -1 && pos < node.start + 10) {
        // Same off-by-one guard as the async-keyword removal above.
        // Remove the 5-char "await" keyword plus only a TRAILING SPACE
        // (never a non-space followup char like `(` or `[`).
        const end = pos + 5 + (mjsContent.charCodeAt(pos + 5) === 0x20 ? 1 : 0)
        safeRemove(pos, end)
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
      }
    },
  }
}
