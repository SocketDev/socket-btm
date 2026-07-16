'use strict'

// Documentation: docs/additions/lib/smol-manifest.js.md

const { ObjectFreeze } = primordials

const {
  parse,
  parseManifest,
  parseLockfile,
  createStreamingParser,
  analyzeLockfile,
  getPackage,
  findPackages,
  detectFormat,
  supportedFiles,
  ManifestError,
} = require('internal/socketsecurity/manifest')

module.exports = ObjectFreeze({
  __proto__: null,
  parse,
  parseManifest,
  parseLockfile,
  createStreamingParser,
  analyzeLockfile,
  getPackage,
  findPackages,
  detectFormat,
  supportedFiles,
  ManifestError,
  default: ObjectFreeze({
    __proto__: null,
    parse,
    parseManifest,
    parseLockfile,
    createStreamingParser,
    analyzeLockfile,
    getPackage,
    findPackages,
    detectFormat,
    supportedFiles,
  }),
})
