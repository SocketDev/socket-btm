# Socket Security: node-smol SEA Bootstrap

Sets up process.smol object, process.argv handling, and require.resolve support.
Follows yao-pkg patterns for ecosystem compatibility.

IMPORTANT: This file runs during early bootstrap, before the full require()
system is initialized. Use require('path') not require('node:path') - the
node: protocol isn't available at this stage.

## History: Why 'use strict' in Every File

Node.js internal files are loaded as CommonJS, which is sloppy-mode by
default. Without strict mode, typos create globals (`typo = 5` silently
creates globalThis.typo), `this` in functions is globalThis (information
leak), and duplicate parameter names are silently allowed. ESM made strict
mode automatic, but Node.js internals predate ESM by years. Every internal
file opts in explicitly for safety.
