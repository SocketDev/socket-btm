/**
 * Common AST transformations for both CJS and ESM sync wrappers.
 *
 * Applies transformations that are shared between CommonJS and ESM:
 * - Remove export/import statements
 * - Remove async/await keywords
 * - Transform WebAssembly.instantiate to synchronous WebAssembly.Instance
 * - Clean up Promise patterns
 * - Handle Node.js module patterns.
 *
 * Visitor implementations are split into:
 * - transform-decl-visitor.mts: declaration/function/async handlers
 * - transform-call-visitor.mts: call/variable/return handlers.
 */

import { Parser } from 'acorn'
import { ancestor, simple as walkSimple } from 'acorn-walk'
import MagicString from 'magic-string'

import { buildCallVisitor } from './transform-call-visitor.mts'
import { buildDeclVisitor } from './transform-decl-visitor.mts'

/**
 * Apply common transformations to MJS content.
 *
 * @param {object} options - Transform options.
 * @param {string} options.mtsContent - MJS content to transform.
 * @param {string} options.initFunctionName - Init function name.
 * @param {string} options.exportName - Export name.
 * @param {object} options.logger - Logger instance.
 *
 * @returns {Promise<string>} Transformed content
 */
export async function applyCommonTransforms(options) {
  const {
    exportName,
    initFunctionName,
    logger,
    mjsContent: inputContent,
  } = { __proto__: null, ...options } as typeof options

  let mjsContent = inputContent

  // Detect the Emscripten-generated module variable. Older onnx output
  // used `var D=Object.assign({},moduleArg)`; newer minified output
  // collapses this to `var n=moduleArg` and keeps moduleArg itself as
  // the module. The transform below replaces `return moduleRtn` with
  // `return <moduleVar>`, so we MUST read the real name instead of
  // hardcoding 'D' (which in newer builds is the HEAP8 typed-array
  // alias, causing the sync wrapper to export a 16MB Int8Array).
  const detectedModuleVar =
    mjsContent.match(
      /\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*Object\.assign\(\s*\{\s*\}\s*,\s*moduleArg\s*\)/,
    )?.[1] ||
    mjsContent.match(/\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*moduleArg\b/)?.[1]

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

  const topLevelStatementsToRemove = []
  const requireDeclaratorsToRemove = []
  const returnModuleToFix = []
  // Track functions that need WebAssembly.instantiate replacement
  const functionsToGut = []

  const sharedState = {
    detectedModuleVar,
    exportName,
    functionsToGut,
    initFunctionName,
    mjsContent,
    requireDeclaratorsToRemove,
    returnModuleToFix,
    safeOverwrite,
    safeRemove,
    topLevelStatementsToRemove,
  }

  ancestor(ast, {
    ...buildDeclVisitor(sharedState),
    ...buildCallVisitor(sharedState),
  })

  // Handle require declarators - remove them from their variable declarations
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
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
      if (commaIndex !== -1) {
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
      if (commaIndex !== -1) {
        safeRemove(prevDeclarator.end + commaIndex, declaratorNode.end)
      } else {
        safeRemove(prevDeclarator.end, declaratorNode.end)
      }
    }
  }

  // Remove all top-level statements containing await
  for (let i = 0, { length } = topLevelStatementsToRemove; i < length; i += 1) {
    const node = topLevelStatementsToRemove[i]
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
          const frame = ancestors[i]
          if (frame.type === 'FunctionDeclaration') {
            // Check if we're inside the Module function
            if (frame.id?.name === 'Module') {
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
          const paramCounts = {}
          let foundInstantiate = false

          walkSimple(node, {
            CallExpression(callNode) {
              const { callee } = callNode

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
            const sortedParams = paramEntries.toSorted(([, a], [, b]) => b - a)
            importsParam = sortedParams[0][0]
          }

          // Strategy 2: Look for variable declarations in the function body that construct imports
          if (!foundInstantiate) {
            const bodyStatements = node.body.body
            for (let i = 0, { length } = bodyStatements; i < length; i += 1) {
              const stmt = bodyStatements[i]
              if (stmt.type === 'VariableDeclaration') {
                // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
                for (const decl of stmt.declarations) {
                  const varName = decl.id?.name
                  if (!varName) {
                    continue
                  }

                  // Look for object literal declarations using AST
                  if (decl.init?.type === 'ObjectExpression') {
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
