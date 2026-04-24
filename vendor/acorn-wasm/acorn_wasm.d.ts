/* tslint:disable */
/* eslint-disable */
/**
 * Standalone parse function (matches Acorn API)
 */
export function parse(code: string, options: any): any;
/**
 * Check if code has syntax errors (returns true if valid)
 */
export function is_valid(code: string): boolean;
/**
 * Find innermost node containing position
 */
export function findNodeAround(code: string, pos: number, node_type: string | null | undefined, options_js: any): any;
/**
 * Find first node starting at or after position
 */
export function findNodeAfter(code: string, pos: number, node_type: string | null | undefined, options_js: any): any;
/**
 * Find outermost node ending before position
 */
export function findNodeBefore(code: string, pos: number, node_type: string | null | undefined, options_js: any): any;
/**
 * Get version information
 */
export function version(): string;
/**
 * Simple walk - parse code and call visitor for each node type
 */
export function simple(code: string, visitors_obj: any, options_js: any): void;
/**
 * Walk with ancestors
 */
export function walk(code: string, visitors_obj: any, options_js: any): void;
/**
 * Full walk with enter/exit
 */
export function full(code: string, visitors_obj: any, options_js: any): void;
/**
 * Recursive walk — visitor controls child traversal via c(child, state)
 */
export function recursive(code: string, state: any, funcs: any, options_js: any): void;
/**
 * Find all nodes matching a type string
 */
export function findAll(code: string, node_type: string, options_js: any): any;
/**
 * Count nodes by type
 */
export function countNodes(code: string, options_js: any): any;
/**
 * Walk all nodes, calling callback with (node, ancestors) for every node
 */
export function fullAncestor(code: string, callback: any, options_js: any): void;
/**
 * Find innermost node at exact start/end position
 */
export function findNodeAt(code: string, start: number | null | undefined, end: number | null | undefined, node_type: string | null | undefined, options_js: any): any;
export class WasmParser {
  free(): void;
  [Symbol.dispose](): void;
  constructor();
  /**
   * Parse JavaScript code and return AST as JsValue (WASM) or JSON string (native)
   */
  parse(code: string, options_js: any): any;
}
