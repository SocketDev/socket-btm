/**
 * @file CommonJS conversion for the fast-webstreams vendor sync.
 */

interface ReExportEntry {
  names: Array<{ alias: string; original: string }>
  source: string
  tempVar: string
}

/**
 * Convert relative imports to absolute Node internal module paths.
 */
export function toInternalPath(source: string): string {
  if (source.startsWith('./')) {
    const basename = source.slice(2).replace(/\.js$/, '')
    return `internal/deps/fast-webstreams/${basename}`
  }
  if (source.startsWith('../')) {
    const basename = source.replace(/^\.\.\//, '').replace(/\.js$/, '')
    return `internal/deps/${basename}`
  }
  return source
}

/**
 * Convert an ES module to CommonJS while preserving circular exports.
 */
export function convertToCommonJS(content: string, _filename: string): string {
  let result = content

  if (!result.startsWith("'use strict'")) {
    result = `'use strict'\n\n${result}`
  }

  const localExports = new Set<string>()
  const reExports: ReExportEntry[] = []

  // Capture named re-exports and their source module.
  result = result.replace(
    /export\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g,
    (_match, items: string, source: string) => {
      const normalizedSource = source.replace(/^node:/, '')
      const names = items.split(',').map(item => {
        const parts = item.trim().split(/\s+as\s+/)
        const original = (parts[0] ?? '').trim()
        const aliasPart = parts[1]
        const alias =
          parts.length > 1 && aliasPart !== undefined
            ? aliasPart.trim()
            : original
        return { original, alias }
      })
      const tempVar = `_reexport_${reExports.length}`
      const requirePath = toInternalPath(normalizedSource)
      reExports.push({ tempVar, source: requirePath, names })
      return `const ${tempVar} = require('${requirePath}')`
    },
  )

  // Capture named imports and their source module.
  result = result.replace(
    /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g,
    (_match, imports: string, source: string) => {
      const normalizedSource = source.replace(/^node:/, '')
      const convertedImports = imports
        .split(',')
        .map(item => item.trim().replace(/\s+as\s+/g, ': '))
        .join(', ')
      return `const { ${convertedImports} } = require('${toInternalPath(normalizedSource)}')`
    },
  )

  // Capture a default import and its source module.
  result = result.replace(
    /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
    (_match, name: string, source: string) => {
      const normalizedSource = source.replace(/^node:/, '')
      return `const ${name} = require('${toInternalPath(normalizedSource)}')`
    },
  )

  // Capture a namespace import and its source module.
  result = result.replace(
    /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
    (_match, name: string, source: string) => {
      const normalizedSource = source.replace(/^node:/, '')
      return `const ${name} = require('${toInternalPath(normalizedSource)}')`
    },
  )

  result = result.replace(
    /export\s+const\s+(\w+)\s*=/g,
    (_match, name: string) => {
      localExports.add(name)
      return `const ${name} =`
    },
  )
  result = result.replace(
    /export\s+function\s+(\w+)\s*\(/g,
    (_match, name: string) => {
      localExports.add(name)
      return `function ${name}(`
    },
  )
  result = result.replace(
    /export\s+async\s+function\s+(\w+)\s*\(/g,
    (_match, name: string) => {
      localExports.add(name)
      return `async function ${name}(`
    },
  )
  result = result.replace(/export\s+class\s+(\w+)/g, (_match, name: string) => {
    localExports.add(name)
    return `class ${name}`
  })
  // Capture local named exports, excluding re-export statements.
  result = result.replace(
    /export\s*\{\s*([^}]+)\s*\}(?!\s*from)/g,
    (_match, items: string) => {
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is an array-producing expression.
      for (const item of items.split(',')) {
        const name = item
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim()
        if (name) {
          localExports.add(name)
        }
      }
      return ''
    },
  )

  const exportLines: string[] = []
  for (const { names, tempVar } of reExports) {
    for (const { alias, original } of names) {
      exportLines.push(`exports.${alias} = ${tempVar}.${original};`)
    }
  }
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is an array-producing expression.
  for (const name of Array.from(localExports).toSorted()) {
    exportLines.push(`exports.${name} = ${name};`)
  }
  if (exportLines.length > 0) {
    result += `\n\n${exportLines.join('\n')}\n`
  }

  return result
}
