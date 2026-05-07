/** Options for parsing and walking. */
export interface AcornOptions {
  /** ECMAScript version. Use 'latest' for newest features, or a year like 2024. */
  ecmaVersion?: number | 'latest'
  /** How to treat the code: 'script' (default), 'module' (enables import/export), or 'commonjs'. */
  sourceType?: 'script' | 'module' | 'commonjs'
  /** Enable TypeScript syntax (interface, type, enum, type annotations, etc.). */
  typescript?: boolean
  /** Enable JSX syntax (<div>, <Component />, etc.). */
  jsx?: boolean
  /** Include line/column location info on each node (node.loc). */
  locations?: boolean
  /** Include range arrays on each node (node.range). */
  ranges?: boolean
  /** Allow return statements outside of functions. */
  allowReturnOutsideFunction?: boolean
  /** Allow import/export statements anywhere (not just top level). */
  allowImportExportEverywhere?: boolean
  /** Allow await outside of async functions (top-level await). */
  allowAwaitOutsideFunction?: boolean
  /** Allow super outside of methods. */
  allowSuperOutsideMethod?: boolean
  /** Allow hashbang (#!) at the start of the file. */
  allowHashBang?: boolean
  /** Keep parenthesized expressions in the AST. */
  preserveParens?: boolean
  /** Filename to include in error messages and location info. */
  sourceFile?: string
}

/** An AST node returned by the parser. */
export interface AcornNode {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

/** Visitor callbacks — keys are AST node type names (e.g. 'ImportDeclaration'). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AcornVisitors = Record<string, (node: any, ...args: any[]) => void>

/** Visitor with enter/exit callbacks for full walks. */
export interface AcornFullVisitors {
  enter?: (node: AcornNode, ancestors: AcornNode[]) => void
  exit?: (node: AcornNode, ancestors: AcornNode[]) => void
}

// ── Parsing ──────────────────────────────────────────────────────────

/** Parse source code into an AST. */
export function parse(code: string, options: AcornOptions): AcornNode

/** Check if code has syntax errors. Returns true if valid. */
export function is_valid(code: string): boolean

/** Get the parser version string. */
export function version(): string

// ── Walking ──────────────────────────────────────────────────────────

/** Call visitor callbacks for matching node types (depth-first). */
export function simple(code: string, visitors: AcornVisitors, options: AcornOptions): void

/** Like simple, but each callback also receives an ancestors array. */
export function walk(code: string, visitors: AcornVisitors, options: AcornOptions): void

/** Call enter/exit callbacks for every node regardless of type. */
export function full(code: string, visitors: AcornFullVisitors, options: AcornOptions): void

/** Call a callback with (node, ancestors) for every node. */
export function fullAncestor(code: string, callback: (node: any, ancestors: any[]) => void, options: AcornOptions): void

/** Visitor controls child traversal — matched types skip default walk. */
export function recursive(code: string, state: unknown, funcs: AcornVisitors, options: AcornOptions): void

// ── Querying ─────────────────────────────────────────────────────────

/** Find innermost node at exact [start, end) byte range. Pass null to match any. */
export function findNodeAt(code: string, start: number | null, end: number | null, nodeType: string | null, options: AcornOptions): AcornNode | undefined

/** Find innermost node containing the byte position. */
export function findNodeAround(code: string, pos: number, nodeType: string | null, options: AcornOptions): AcornNode | undefined

/** Find the first node starting at or after the byte position. */
export function findNodeAfter(code: string, pos: number, nodeType: string | null, options: AcornOptions): AcornNode | undefined

/** Find the outermost node ending before the byte position. */
export function findNodeBefore(code: string, pos: number, nodeType: string | null, options: AcornOptions): AcornNode | undefined

/** Find all nodes matching a type string. */
export function findAll(code: string, nodeType: string, options: AcornOptions): AcornNode[]

/** Count nodes by type. Returns { TypeName: count, ... }. */
export function countNodes(code: string, options: AcornOptions): Record<string, number>
