import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.{js,mjs,ts,mts}'],
    exclude: ['build/**', 'node_modules/**', 'upstream/**'],
  },
})
