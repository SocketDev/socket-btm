/**
 * Add primordials protection to all fast-webstreams files.
 *
 * Replaces direct Promise.* calls with primordials equivalents:
 *
 * - Promise.resolve() → PromiseResolve()
 * - Promise.reject() → PromiseReject()
 * - New Promise() → new SafePromise()
 * - Promise.all() → settleAllPreservingFirstRejection() (pipe-to.js only) — an
 *   injected helper that attaches PromisePrototypeThen directly to each
 *   element. SafePromiseAllReturnVoid would wrap each element in
 *   PromiseResolve(), which is identity for native promises but adds
 *   thenable-assimilation microtask hops for SafePromise elements
 *   (writer.abort() returns one after the new-Promise rewrite above); the skew
 *   flips which rejection wins pipeTo's abort race — WPT piping/abort.any.js
 *   requires underlyingSink.abort()'s rejection to beat
 *   underlyingSource.cancel()'s.
 *
 * This protects against prototype pollution attacks on Promise methods.
 */
export function addPrimordialsProtection(content: string, filename: string) {
  // Check if this file uses any Promise patterns that need protection
  const usesPromiseResolve = /Promise\.resolve\s*\(/g.test(content)
  const usesPromiseReject = /Promise\.reject\s*\(/g.test(content)
  const usesNewPromise = /new\s+Promise\s*\(/g.test(content)
  const usesPromiseAll = /Promise\.all\s*\(/g.test(content)

  const needsPrimordials =
    usesNewPromise || usesPromiseAll || usesPromiseReject || usesPromiseResolve

  if (!needsPrimordials) {
    return content
  }

  // Build the primordials import based on what's needed
  const primordialImports = []
  if (usesPromiseResolve) {
    primordialImports.push('PromiseResolve')
  }
  if (usesPromiseReject) {
    primordialImports.push('PromiseReject')
  }
  if (usesNewPromise) {
    primordialImports.push('SafePromise')
  }
  const injectSettleAll = usesPromiseAll && filename === 'pipe-to.js'
  if (injectSettleAll) {
    for (const name of ['PromisePrototypeThen', 'SafePromise']) {
      if (!primordialImports.includes(name)) {
        primordialImports.push(name)
      }
    }
  }

  // Find insertion point - after 'use strict' and any initial requires
  // Insert primordials import at the top, right after 'use strict'
  const useStrictMatch = content.match(/^'use strict'\s*\n/)
  if (useStrictMatch) {
    const insertPoint = useStrictMatch[0].length
    const primordialsComment =
      '// Use primordials for protection against prototype pollution'
    const primordialsImport = `const {\n  ${primordialImports.join(',\n  ')},\n} = primordials`
    // Every element at pipe-to.js's Promise.all call site is a genuine
    // promise (writer.abort() → SafePromise, reader.cancel() → native,
    // RESOLVED_UNDEFINED → native), so attaching PromisePrototypeThen
    // directly is safe and preserves settle-order rejection delivery.
    const settleAllHelper = injectSettleAll
      ? `\nfunction settleAllPreservingFirstRejection(promises) {\n  return new SafePromise((resolve, reject) => {\n    let pending = promises.length;\n    if (pending === 0) resolve();\n    const onFulfilled = () => {\n      if (--pending === 0) resolve();\n    };\n    for (let i = 0; i < promises.length; i++) {\n      PromisePrototypeThen(promises[i], onFulfilled, reject);\n    }\n  });\n}\n`
      : ''

    content =
      content.slice(0, insertPoint) +
      `\n${primordialsComment}\n${primordialsImport}\n${settleAllHelper}` +
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
  if (injectSettleAll) {
    // Only pipe-to.js currently discards Promise.all's resolved array (the
    // pipeline awaits side effects, not values). For any other vendored
    // file that uses Promise.all the callers consume the result array, so
    // a void-returning combinator would silently corrupt the pipeline.
    content = content.replace(
      /Promise\.all\s*\(/g,
      'settleAllPreservingFirstRejection(',
    )
  }

  return content
}
