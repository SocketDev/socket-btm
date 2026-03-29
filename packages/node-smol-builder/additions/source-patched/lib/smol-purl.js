'use strict'

// node:smol-purl - High-Performance Package URL (PURL) Parser
// Parses Package URLs per the PURL spec: https://github.com/package-url/purl-spec
//
// Usage:
//   import { parse, build } from 'node:smol-purl';
//
//   const purl = parse('pkg:npm/%40scope/name@1.0.0');
//   console.log(purl.type);      // 'npm'
//   console.log(purl.namespace); // '@scope'
//   console.log(purl.name);      // 'name'
//   console.log(purl.version);   // '1.0.0'
//
//   const str = build({ type: 'npm', name: 'lodash', version: '4.17.21' });
//   console.log(str); // 'pkg:npm/lodash@4.17.21'

const { ObjectFreeze } = primordials

const {
  parse,
  tryParse,
  parseBatch,
  build,
  isValid,
  normalize,
  equals,
  cacheStats,
  clearCache,
  types,
  PurlError,
} = require('internal/socketsecurity/purl')

module.exports = ObjectFreeze({
  __proto__: null,
  parse,
  tryParse,
  parseBatch,
  build,
  isValid,
  normalize,
  equals,
  cacheStats,
  clearCache,
  types,
  PurlError,
  default: ObjectFreeze({
    __proto__: null,
    parse,
    tryParse,
    parseBatch,
    build,
    isValid,
    normalize,
    equals,
    cacheStats,
    clearCache,
    types,
  }),
})
