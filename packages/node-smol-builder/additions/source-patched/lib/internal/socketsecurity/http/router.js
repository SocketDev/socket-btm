'use strict';

// Trie-based HTTP Router
// O(log n) route matching with support for params and wildcards.
// PERFORMANCE: All helper functions at module level to avoid per-call allocation.

const {
  ArrayPrototypePop,
  ArrayPrototypePush,
  MapPrototypeGet,
  MapPrototypeSet,
  ObjectKeys,
  SafeMap,
  StringPrototypeCharCodeAt,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
} = primordials;

const { SLASH_REGEX } = require('internal/socketsecurity/http/constants');

// ============================================================================
// Trie Node Types
// ============================================================================

const TRIE_NODE_STATIC = 0;   // Literal path segment
const TRIE_NODE_PARAM = 1;    // :param
const TRIE_NODE_WILDCARD = 2; // *

// ============================================================================
// Params Object Pool (avoids allocation per request)
// ============================================================================

const PARAMS_POOL_SIZE = 64;
const paramsPool = [];

function acquireParams() {
  if (paramsPool.length > 0) {
    return ArrayPrototypePop(paramsPool);
  }
  return { __proto__: null };
}

function releaseParams(params) {
  if (paramsPool.length >= PARAMS_POOL_SIZE) return;
  // Reset all keys to undefined (faster than delete, avoids deoptimization)
  const keys = ObjectKeys(params);
  for (let i = 0; i < keys.length; i++) {
    params[keys[i]] = undefined;
  }
  ArrayPrototypePush(paramsPool, params);
}

// ============================================================================
// Match Result Pool (avoids allocation per request)
// ============================================================================

const RESULT_POOL_SIZE = 64;
const resultPool = [];

function acquireResult() {
  if (resultPool.length > 0) {
    return ArrayPrototypePop(resultPool);
  }
  return { __proto__: null, handler: undefined, params: undefined };
}

function releaseResult(result) {
  if (resultPool.length >= RESULT_POOL_SIZE) return;
  result.handler = undefined;
  result.params = undefined;
  ArrayPrototypePush(resultPool, result);
}

// ============================================================================
// Trie Implementation
// ============================================================================

/**
 * Create a new trie node.
 * @returns {object}
 */
function createTrieNode() {
  return {
    __proto__: null,
    type: TRIE_NODE_STATIC,
    children: new SafeMap(),   // segment -> TrieNode
    paramChild: undefined,     // :param child
    wildcardChild: undefined,  // * child
    handler: undefined,        // Handler function
    methods: undefined,        // Per-method handlers { GET: fn, POST: fn }
    paramName: undefined,      // Name of param if type is PARAM
  };
}

/**
 * Insert a route into the trie.
 * @param {object} root - Trie root node
 * @param {string} pattern - Route pattern
 * @param {function|object} handler - Handler function or method map
 */
function trieInsert(root, pattern, handler) {
  const parts = StringPrototypeSplit(pattern, SLASH_REGEX);
  let node = root;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    if (part === '*') {
      // Wildcard - match everything
      if (!node.wildcardChild) {
        node.wildcardChild = createTrieNode();
        node.wildcardChild.type = TRIE_NODE_WILDCARD;
        node.wildcardChild.paramName = '$wildcard';
      }
      node = node.wildcardChild;
    } else if (StringPrototypeStartsWith(part, ':')) {
      // Dynamic param
      if (!node.paramChild) {
        node.paramChild = createTrieNode();
        node.paramChild.type = TRIE_NODE_PARAM;
      }
      node.paramChild.paramName = StringPrototypeSlice(part, 1);
      node = node.paramChild;
    } else {
      // Static segment
      let child = MapPrototypeGet(node.children, part);
      if (!child) {
        child = createTrieNode();
        MapPrototypeSet(node.children, part, child);
      }
      node = child;
    }
  }

  // Set handler at terminal node
  if (typeof handler === 'function') {
    node.handler = handler;
  } else if (handler && typeof handler === 'object') {
    node.methods = { __proto__: null, ...handler };
  }
}

// Reusable segment result (avoids object allocation per segment)
const segmentResult = { __proto__: null, segment: '', start: 0, end: 0 };

// Module-level backtracking stack (avoids allocation per trieMatch call)
const matchStack = [];

/**
 * Get next path segment (module-level to avoid per-call allocation).
 * @param {string} pathname - URL pathname
 * @param {number} pathLen - Length of pathname
 * @param {number} startPos - Starting position
 * @returns {object} Reused segment result object
 */
function getNextSegment(pathname, pathLen, startPos) {
  // Skip leading slash
  let start = startPos;
  while (start < pathLen && StringPrototypeCharCodeAt(pathname, start) === 47) { // '/'
    start++;
  }
  if (start >= pathLen) {
    segmentResult.segment = '';
    segmentResult.start = pathLen;
    segmentResult.end = pathLen;
    return segmentResult;
  }
  // Find end of segment
  let end = start;
  while (end < pathLen && StringPrototypeCharCodeAt(pathname, end) !== 47) { // '/'
    end++;
  }
  segmentResult.segment = StringPrototypeSlice(pathname, start, end);
  segmentResult.start = start;
  segmentResult.end = end;
  return segmentResult;
}

/**
 * Get remaining path from position (for wildcard capture).
 * @param {string} pathname - URL pathname
 * @param {number} pathLen - Length of pathname
 * @param {number} pos - Starting position
 * @returns {string} Remaining path
 */
function getRemainingPath(pathname, pathLen, pos) {
  // Skip leading slash
  let start = pos;
  while (start < pathLen && StringPrototypeCharCodeAt(pathname, start) === 47) {
    start++;
  }
  if (start >= pathLen) return '';
  return StringPrototypeSlice(pathname, start);
}

/**
 * Match a pathname against the trie using iterative search with pooled objects.
 * @param {object} root - Trie root node
 * @param {string} pathname - URL pathname
 * @param {string} method - HTTP method
 * @returns {{handler: function, params: object}|undefined}
 */
function trieMatch(root, pathname, method) {
  const params = acquireParams();
  const pathLen = pathname.length;

  // Reset module-level backtracking stack
  const stack = matchStack;
  stack.length = 0;
  let node = root;
  let pos = 0;

  while (true) {
    // Get next segment
    const seg = getNextSegment(pathname, pathLen, pos);
    const segment = seg.segment;
    const end = seg.end;

    // Base case: no more segments - check for handler
    if (!segment) {
      let handler;
      if (node.handler) {
        handler = node.handler;
      } else if (node.methods) {
        handler = node.methods[method] || node.methods['*'];
      }

      if (handler) {
        // Don't release params - caller will use them
        const result = acquireResult();
        result.handler = handler;
        result.params = params;
        return result;
      }

      // Backtrack if possible
      if (stack.length === 0) {
        releaseParams(params);
        return undefined;
      }

      const frame = ArrayPrototypePop(stack);
      node = frame.node;
      pos = frame.pos;
      // Clear param if we set one
      if (frame.paramName) {
        params[frame.paramName] = undefined;
      }
      continue;
    }

    // Priority 1: Static match (most specific)
    const staticChild = MapPrototypeGet(node.children, segment);
    if (staticChild) {
      // Push alternatives for backtracking
      if (node.paramChild) {
        ArrayPrototypePush(stack, {
          __proto__: null,
          node,
          pos,
          tryParam: true,
          segment,
          end,
          paramName: undefined,
        });
      }
      node = staticChild;
      pos = end;
      continue;
    }

    // Priority 2: Param match
    if (node.paramChild) {
      const paramName = node.paramChild.paramName;
      params[paramName] = segment;
      // Push wildcard alternative for backtracking
      if (node.wildcardChild) {
        ArrayPrototypePush(stack, {
          __proto__: null,
          node,
          pos,
          tryWildcard: true,
          paramName,
        });
      }
      node = node.paramChild;
      pos = end;
      continue;
    }

    // Priority 3: Wildcard match (captures rest)
    if (node.wildcardChild) {
      params[node.wildcardChild.paramName] = getRemainingPath(pathname, pathLen, pos);
      let handler;
      if (node.wildcardChild.handler) {
        handler = node.wildcardChild.handler;
      } else if (node.wildcardChild.methods) {
        handler = node.wildcardChild.methods[method] || node.wildcardChild.methods['*'];
      }

      if (handler) {
        const result = acquireResult();
        result.handler = handler;
        result.params = params;
        return result;
      }
    }

    // No match - backtrack
    if (stack.length === 0) {
      releaseParams(params);
      return undefined;
    }

    const frame = ArrayPrototypePop(stack);
    if (frame.tryParam && frame.node.paramChild) {
      const paramName = frame.node.paramChild.paramName;
      params[paramName] = frame.segment;
      node = frame.node.paramChild;
      pos = frame.end;
      continue;
    }
    if (frame.tryWildcard && frame.node.wildcardChild) {
      if (frame.paramName) {
        params[frame.paramName] = undefined;
      }
      params[frame.node.wildcardChild.paramName] = getRemainingPath(pathname, pathLen, frame.pos);
      let handler;
      if (frame.node.wildcardChild.handler) {
        handler = frame.node.wildcardChild.handler;
      } else if (frame.node.wildcardChild.methods) {
        handler = frame.node.wildcardChild.methods[method] || frame.node.wildcardChild.methods['*'];
      }
      if (handler) {
        const result = acquireResult();
        result.handler = handler;
        result.params = params;
        return result;
      }
    }
    // Clear param and continue backtracking
    if (frame.paramName) {
      params[frame.paramName] = undefined;
    }
  }
}

module.exports = {
  __proto__: null,
  createTrieNode,
  trieInsert,
  trieMatch,
  // Pool release functions (call after done with route match result)
  releaseParams,
  releaseResult,
};
