node:smol-ffi - Cross-platform Foreign Function Interface
Call native C functions from JavaScript without compiling addons.

Usage:
import ffi from 'node:smol-ffi';

const lib = ffi.open('libm.so.6');
const sqrt = lib.func('sqrt', 'f64', ['f64']);
console.log(sqrt(16)); // 4
lib.close();

Or with batch definitions (upstream-compatible):
const { lib, functions } = ffi.dlopen('libm.so.6', {
sqrt: { result: 'f64', parameters: ['f64'] },
});
