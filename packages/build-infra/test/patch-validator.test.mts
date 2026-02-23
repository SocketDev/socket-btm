/**
 * @fileoverview Tests for patch-validator utilities.
 * Validates patch file validation, application, and conflict detection.
 */

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  analyzePatchContent,
  checkPatchConflicts,
} from '../lib/patch-validator.mjs'

describe('patch-validator', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `patch-validator-test-${Date.now()}`)
    await fs.mkdir(tempDir, { recursive: true })
  })

  describe('analyzePatchContent', () => {
    it('should detect V8 includes modifications', () => {
      const content = `
diff --git a/src/node.cc b/src/node.cc
index 123..456 100644
--- a/src/node.cc
+++ b/src/node.cc
@@ -1,5 +1,5 @@
+#include "v8.h"
 #include "node.h"
`
      const analysis = analyzePatchContent(content)

      expect(analysis.modifiesV8Includes).toBe(true)
    })

    it('should detect V8 header modifications with v8- prefix', () => {
      const content = `
diff --git a/src/node.cc b/src/node.cc
+#include "v8-platform.h"
`
      const analysis = analyzePatchContent(content)

      expect(analysis.modifiesV8Includes).toBe(true)
    })

    it('should detect SEA modifications', () => {
      const content = `
diff --git a/src/sea.cc b/src/sea.cc
@@ -10,5 +10,5 @@
-sea_init();
+sea_main();
`
      const analysis = analyzePatchContent(content)

      expect(analysis.modifiesSEA).toBe(true)
    })

    it('should detect Brotli modifications', () => {
      const content = `
diff --git a/deps/brotli/common.h b/deps/brotli/common.h
+#define BROTLI_VERSION "1.0.9"
`
      const analysis = analyzePatchContent(content)

      expect(analysis.modifiesBrotli).toBe(true)
    })

    it('should detect multiple modification types', () => {
      const content = `
diff --git a/src/node.cc b/src/node.cc
+#include "v8.h"
+#include "brotli/encode.h"
+void InitializeSEA() {
`
      const analysis = analyzePatchContent(content)

      expect(analysis.modifiesV8Includes).toBe(true)
      expect(analysis.modifiesSEA).toBe(true)
      expect(analysis.modifiesBrotli).toBe(true)
    })

    it('should return false for non-matching content', () => {
      const content = `
diff --git a/src/util.cc b/src/util.cc
+int add(int a, int b) { return a + b; }
`
      const analysis = analyzePatchContent(content)

      expect(analysis.modifiesV8Includes).toBe(false)
      expect(analysis.modifiesSEA).toBe(false)
      expect(analysis.modifiesBrotli).toBe(false)
    })
  })

  describe('checkPatchConflicts', () => {
    it('should detect no conflicts when patches modify different files', () => {
      const patches = [
        {
          content: `
--- a/file1.js
+++ b/file1.js
@@ -1,3 +1,3 @@
-old line
+new line
`,
          name: 'patch1.patch',
        },
        {
          content: `
--- a/file2.js
+++ b/file2.js
@@ -1,3 +1,3 @@
-old line
+new line
`,
          name: 'patch2.patch',
        },
      ]

      const conflicts = checkPatchConflicts(patches)

      expect(conflicts).toHaveLength(0)
    })

    it('should detect conflicts when patches modify same file at overlapping lines', () => {
      const patches = [
        {
          content: `
--- a/file.js
+++ b/file.js
@@ -10,5 +10,5 @@
-old line
+new line
`,
          name: 'patch1.patch',
        },
        {
          content: `
--- a/file.js
+++ b/file.js
@@ -12,3 +12,3 @@
-another old line
+another new line
`,
          name: 'patch2.patch',
        },
      ]

      const conflicts = checkPatchConflicts(patches)

      expect(conflicts.length).toBeGreaterThan(0)
      expect(conflicts[0].severity).toBe('error')
      expect(conflicts[0].message).toContain('patch1.patch')
      expect(conflicts[0].message).toContain('patch2.patch')
      expect(conflicts[0].message).toContain('overlapping lines')
    })

    it('should not detect conflicts when patches modify same file at non-overlapping lines', () => {
      const patches = [
        {
          content: `
--- a/file.js
+++ b/file.js
@@ -10,3 +10,3 @@
-old line 10
+new line 10
`,
          name: 'patch1.patch',
        },
        {
          content: `
--- a/file.js
+++ b/file.js
@@ -50,3 +50,3 @@
-old line 50
+new line 50
`,
          name: 'patch2.patch',
        },
      ]

      const conflicts = checkPatchConflicts(patches)

      expect(conflicts).toHaveLength(0)
    })

    it('should warn about patches with missing content', () => {
      const patches = [
        {
          name: 'empty-patch.patch',
        },
        {
          content: `
--- a/file.js
+++ b/file.js
@@ -1,3 +1,3 @@
`,
          name: 'valid-patch.patch',
        },
      ]

      const conflicts = checkPatchConflicts(patches)

      expect(conflicts.length).toBeGreaterThan(0)
      expect(conflicts[0].severity).toBe('warning')
      expect(conflicts[0].message).toContain('missing content')
    })

    it('should handle multiple hunks in same file', () => {
      const patches = [
        {
          content: `
--- a/file.js
+++ b/file.js
@@ -10,5 +10,5 @@
-old line 10
+new line 10
@@ -20,3 +20,3 @@
-old line 20
+new line 20
`,
          name: 'patch1.patch',
        },
        {
          content: `
--- a/file.js
+++ b/file.js
@@ -12,3 +12,3 @@
-old line 12
+new line 12
`,
          name: 'patch2.patch',
        },
      ]

      const conflicts = checkPatchConflicts(patches)

      // patch2 at line 12-14 overlaps with patch1's first hunk at line 10-14 (5 lines)
      expect(conflicts.length).toBeGreaterThan(0)
    })

    it('should handle patches with single-line changes', () => {
      const patches = [
        {
          content: `
--- a/file.js
+++ b/file.js
@@ -10 +10 @@
-old line
+new line
`,
          name: 'patch1.patch',
        },
        {
          content: `
--- a/file.js
+++ b/file.js
@@ -10 +10 @@
-old line
+different line
`,
          name: 'patch2.patch',
        },
      ]

      const conflicts = checkPatchConflicts(patches)

      expect(conflicts.length).toBeGreaterThan(0)
      expect(conflicts[0].message).toContain('overlapping lines')
    })

    it('should handle empty patch array', () => {
      const conflicts = checkPatchConflicts([])

      expect(conflicts).toHaveLength(0)
    })

    it('should handle single patch', () => {
      const patches = [
        {
          content: `
--- a/file.js
+++ b/file.js
@@ -10,3 +10,3 @@
`,
          name: 'single.patch',
        },
      ]

      const conflicts = checkPatchConflicts(patches)

      expect(conflicts).toHaveLength(0)
    })
  })

  describe('integration scenarios', () => {
    it('should analyze ONNX Runtime-style patches', () => {
      const content = `
diff --git a/onnxruntime/wasm/api.cc b/onnxruntime/wasm/api.cc
index abc123..def456 100644
--- a/onnxruntime/wasm/api.cc
+++ b/onnxruntime/wasm/api.cc
@@ -1,5 +1,5 @@
 #include "onnxruntime_cxx_api.h"
+#include "v8-platform.h"
 #include <emscripten/bind.h>
`
      const analysis = analyzePatchContent(content)

      expect(analysis.modifiesV8Includes).toBe(true)
    })

    it('should detect conflicts in typical build patch scenario', () => {
      const patches = [
        {
          content: `
--- a/CMakeLists.txt
+++ b/CMakeLists.txt
@@ -100,5 +100,5 @@
-set(CMAKE_CXX_FLAGS "\${CMAKE_CXX_FLAGS} -O2")
+set(CMAKE_CXX_FLAGS "\${CMAKE_CXX_FLAGS} -O3")
`,
          name: '001-optimize-flags.patch',
        },
        {
          content: `
--- a/CMakeLists.txt
+++ b/CMakeLists.txt
@@ -102,3 +102,3 @@
-set(CMAKE_C_FLAGS "\${CMAKE_C_FLAGS} -O2")
+set(CMAKE_C_FLAGS "\${CMAKE_C_FLAGS} -O3")
`,
          name: '002-optimize-c-flags.patch',
        },
      ]

      const conflicts = checkPatchConflicts(patches)

      // These should overlap at lines 100-104
      expect(conflicts.length).toBeGreaterThan(0)
    })

    it('should allow sequential non-overlapping patches', () => {
      const patches = [
        {
          content: `
--- a/src/module1.cc
+++ b/src/module1.cc
@@ -50,3 +50,4 @@
 void Init() {
+  // Initialize module1
   module1_init();
`,
          name: 'add-module1-comment.patch',
        },
        {
          content: `
--- a/src/module2.cc
+++ b/src/module2.cc
@@ -50,3 +50,4 @@
 void Init() {
+  // Initialize module2
   module2_init();
`,
          name: 'add-module2-comment.patch',
        },
      ]

      const conflicts = checkPatchConflicts(patches)

      expect(conflicts).toHaveLength(0)
    })
  })

  describe('edge cases', () => {
    it('should handle patches with no file modifications', () => {
      const patches = [
        {
          content: 'This is not a valid patch format',
          name: 'invalid.patch',
        },
      ]

      const conflicts = checkPatchConflicts(patches)

      // Should not crash, may or may not detect issues
      expect(Array.isArray(conflicts)).toBe(true)
    })

    it('should handle patches with complex hunk headers', () => {
      const content = `
--- a/file.js
+++ b/file.js
@@ -100,20 +100,25 @@ function complex() {
-old implementation
+new implementation
`
      const analysis = analyzePatchContent(content)

      // Should parse without crashing
      expect(typeof analysis).toBe('object')
    })

    it('should handle patches with additions only', () => {
      const content = `
--- a/file.js
+++ b/file.js
@@ -10,0 +10,5 @@
+new line 1
+new line 2
+new line 3
`
      const analysis = analyzePatchContent(content)

      expect(typeof analysis).toBe('object')
    })

    it('should handle patches with deletions only', () => {
      const content = `
--- a/file.js
+++ b/file.js
@@ -10,5 +10,0 @@
-deleted line 1
-deleted line 2
`
      const analysis = analyzePatchContent(content)

      expect(typeof analysis).toBe('object')
    })
  })
})
