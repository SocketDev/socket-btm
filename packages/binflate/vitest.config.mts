import { defineConfig } from 'vitest/config'

// @ts-check
export default defineConfig({
  test: {
    // Use forks pool for full process isolation
    // This prevents file system race conditions when tests manipulate binaries
    // and sign them with codesign, which can leave file handles open
    pool: 'forks',
    poolOptions: {
      forks: {
        // Run all tests in single fork sequentially
        singleFork: true,
        // Full isolation between test files
        isolate: true,
      },
    },
    // Increase timeout for compression/decompression operations
    testTimeout: 60_000,
    // Increase hook timeout for setting up test binaries
    hookTimeout: 60_000,
  },
})
