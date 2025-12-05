/**
 * Optimization flags for Emscripten builds
 *
 * Provides CXX and linker flags for production and development builds.
 */

/**
 * Get optimization flags for a build mode.
 *
 * @param {string} buildMode - 'prod' or 'dev'
 * @returns {{cxxFlags: string[], linkerFlags: string[]}}
 */
export function getOptimizationFlags(buildMode) {
  const cxxFlags =
    buildMode === 'prod'
      ? [
          // Production: Maximum size + performance optimizations.
          // Optimize aggressively for size.
          '-Oz',
          // Thin LTO for faster builds, similar size reduction.
          '-flto=thin',
          // No C++ exceptions (smaller).
          '-fno-exceptions',
          // No runtime type information (smaller).
          '-fno-rtti',
          // Separate functions for better dead code elimination.
          '-ffunction-sections',
          // Separate data sections.
          '-fdata-sections',
          // Fast math optimizations (performance).
          '-ffast-math',
          // Re-enable infinity checks (Yoga needs this).
          '-fno-finite-math-only',
        ]
      : [
          // Development: Faster compilation, larger output.
          // Basic optimization (fast compile).
          '-O1',
          '-fno-exceptions',
          '-fno-rtti',
        ]

  const linkerFlags =
    buildMode === 'prod'
      ? [
          // Production: Aggressive minification.
          // Google Closure Compiler (aggressive minification).
          '--closure=1',
          // Garbage collect unused sections.
          '--gc-sections',
          '-flto=thin',
          '-Oz',
          // Disable exception catching (we use -fno-exceptions).
          '-sDISABLE_EXCEPTION_CATCHING=1',
          // Dynamic memory.
          '-sALLOW_MEMORY_GROWTH=1',
          // No runtime assertions (smaller, faster).
          '-sASSERTIONS=0',
          // ES6 module export.
          '-sEXPORT_ES6=1',
          // No filesystem support (smaller).
          '-sFILESYSTEM=0',
          // Minimal initial memory.
          '-sINITIAL_MEMORY=64KB',
          // Smaller allocator.
          '-sMALLOC=emmalloc',
          // Modular output.
          '-sMODULARIZE=1',
          // Keep runtime alive (needed for WASM).
          '-sNO_EXIT_RUNTIME=1',
          // Small stack.
          '-sSTACK_SIZE=16KB',
          // Disable stack overflow checks (fixes __set_stack_limits error with Emscripten 4.x).
          '-sSTACK_OVERFLOW_CHECK=0',
          // No longjmp (smaller).
          '-sSUPPORT_LONGJMP=0',
          // Synchronous instantiation for bundling.
          '-sWASM_ASYNC_COMPILATION=0',
        ]
      : [
          // Development: Faster linking, debug info.
          '-O1',
          // Disable exception catching (we use -fno-exceptions).
          '-sDISABLE_EXCEPTION_CATCHING=1',
          '-sALLOW_MEMORY_GROWTH=1',
          // Enable runtime assertions for debugging.
          '-sASSERTIONS=2',
          '-sEXPORT_ES6=1',
          // Export stack functions to fix __set_stack_limits error with Emscripten 4.x.
          "-sEXPORTED_FUNCTIONS=['_malloc','_free','___set_stack_limits']",
          '-sFILESYSTEM=0',
          '-sMODULARIZE=1',
          '-sNO_EXIT_RUNTIME=1',
          '-sWASM_ASYNC_COMPILATION=0',
        ]

  return { cxxFlags, linkerFlags }
}
