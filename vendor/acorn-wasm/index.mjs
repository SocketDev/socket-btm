import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const wasm = require('./acorn_wasm.cjs')

export const { countNodes, findAll, findNodeAfter, findNodeAround, findNodeAt, findNodeBefore, full, fullAncestor, is_valid, parse, recursive, simple, version, walk } = wasm
