import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(PACKAGE_ROOT, 'dist')
const BUILD_DIR = path.join(DIST_DIR, 'build')

describe('ink build', () => {
  beforeAll(async () => {
    // Ensure dist exists (build should have been run).
    if (!existsSync(DIST_DIR)) {
      throw new Error(
        'dist/ directory not found. Run `pnpm run build` before running tests.'
      )
    }
  })

  describe('dist output structure', () => {
    it('should have package.json', async () => {
      const packageJsonPath = path.join(DIST_DIR, 'package.json')
      expect(existsSync(packageJsonPath)).toBe(true)

      const packageJson = JSON.parse(
        await fs.readFile(packageJsonPath, 'utf8')
      )
      expect(packageJson.name).toBe('ink')
      expect(packageJson._prepatched).toBe(true)
      expect(packageJson._patchedBy).toBe('socket-btm')
    })

    it('should have build directory with JS files', async () => {
      const buildDir = path.join(DIST_DIR, 'build')
      expect(existsSync(buildDir)).toBe(true)

      const files = await fs.readdir(buildDir)
      expect(files).toContain('ink.js')
      expect(files).toContain('dom.js')
      expect(files).toContain('reconciler.js')
    })

    it('should have bundled yoga-sync.mjs', async () => {
      const yogaSyncPath = path.join(DIST_DIR, 'build', 'yoga-sync.mjs')
      expect(existsSync(yogaSyncPath)).toBe(true)

      const stat = await fs.stat(yogaSyncPath)
      // yoga-sync.mjs should be substantial (has embedded WASM).
      expect(stat.size).toBeGreaterThan(100_000)
    })

    it('should not have yoga-layout in dependencies', async () => {
      const packageJsonPath = path.join(DIST_DIR, 'package.json')
      const packageJson = JSON.parse(
        await fs.readFile(packageJsonPath, 'utf8')
      )

      if (packageJson.dependencies) {
        expect(packageJson.dependencies['yoga-layout']).toBeUndefined()
      }
    })
  })

  describe('yoga-layout import rewiring', () => {
    const filesToCheck = [
      'build/ink.js',
      'build/dom.js',
      'build/get-max-width.js',
      'build/styles.js',
      'build/render-node-to-output.js',
      'build/reconciler.js',
    ]

    for (const file of filesToCheck) {
      it(`should rewire yoga import in ${file}`, async () => {
        const filePath = path.join(DIST_DIR, file)
        if (!existsSync(filePath)) {
          // Some files may not exist in all versions.
          return
        }

        const content = await fs.readFile(filePath, 'utf8')

        // Should NOT have yoga-layout import.
        expect(content).not.toMatch(/from ['"]yoga-layout['"]/)
        expect(content).not.toMatch(/import.*['"]yoga-layout['"]/)

        // Should have yoga-sync import.
        expect(content).toMatch(/from ['"]\.\/yoga-sync\.mjs['"]/)
      })
    }
  })

  describe('patches applied', () => {
    it('should have signal-exit named import in ink.js', async () => {
      const inkPath = path.join(DIST_DIR, 'build', 'ink.js')
      const content = await fs.readFile(inkPath, 'utf8')

      // Should use named import { onExit as signalExit }.
      expect(content).toMatch(/import\s*\{\s*onExit\s+as\s+signalExit\s*\}/)
      // Should NOT have default import.
      expect(content).not.toMatch(/import signalExit from ['"]signal-exit['"]/)
    })

    it('should have devtools disabled in reconciler.js', async () => {
      const reconcilerPath = path.join(DIST_DIR, 'build', 'reconciler.js')
      const content = await fs.readFile(reconcilerPath, 'utf8')

      // Should NOT have dynamic devtools import.
      expect(content).not.toMatch(/await import\(['"]\.\/devtools\.js['"]\)/)
      // Should have devtools disabled comment or no-op.
      expect(content).toMatch(/devtools.*disabled|no-op/i)
    })
  })

  describe('yoga-sync functionality', () => {
    it('should be importable and export Yoga with official API', async () => {
      const yogaSyncPath = path.join(DIST_DIR, 'build', 'yoga-sync.mjs')
      const yogaModule = await import(yogaSyncPath)

      // yoga-sync exports the wrapped Yoga module with official API.
      expect(yogaModule.default).toBeDefined()
      const Yoga = yogaModule.default

      // Yoga should have Node.create() factory method (official API).
      expect(typeof Yoga.Node).toBe('function')
      expect(typeof Yoga.Node.create).toBe('function')
      expect(typeof Yoga.Config).toBe('function')

      // Should have flat enum constants (official API).
      // Validate type existence rather than hardcoded values for robustness.
      expect(typeof Yoga.DIRECTION_LTR).toBe('number')
      expect(typeof Yoga.DIRECTION_RTL).toBe('number')
      expect(typeof Yoga.FLEX_DIRECTION_ROW).toBe('number')
      expect(typeof Yoga.FLEX_DIRECTION_COLUMN).toBe('number')
      expect(typeof Yoga.ALIGN_CENTER).toBe('number')
      expect(typeof Yoga.UNIT_POINT).toBe('number')
    })

    it('should be able to create and layout a node', async () => {
      const yogaSyncPath = path.join(DIST_DIR, 'build', 'yoga-sync.mjs')
      const yogaModule = await import(yogaSyncPath)
      const Yoga = yogaModule.default

      // Create node using official API factory method.
      const node = Yoga.Node.create()
      node.setWidth(100)
      node.setHeight(50)
      // calculateLayout with official API: (width, height, direction).
      node.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR)

      expect(node.getComputedWidth()).toBe(100)
      expect(node.getComputedHeight()).toBe(50)

      // Cleanup with official API.
      node.free()
    })
  })

  describe('ink module structure', () => {
    // Test that ink's build output has expected file structure.
    // These tests verify the build output matches upstream ink's API without importing modules
    // (which would require react, react-reconciler, and other peer dependencies).

    it('should have render module', async () => {
      const renderPath = path.join(BUILD_DIR, 'render.js')
      expect(existsSync(renderPath)).toBe(true)

      const content = await fs.readFile(renderPath, 'utf8')
      // render.js should export a default function.
      expect(content).toMatch(/export\s+default/)
    })

    it('should have Box component', async () => {
      const boxPath = path.join(BUILD_DIR, 'components', 'Box.js')
      expect(existsSync(boxPath)).toBe(true)

      const content = await fs.readFile(boxPath, 'utf8')
      // Box should be a React component.
      expect(content).toMatch(/export\s+default/)
      expect(content).toMatch(/forwardRef|React/)
    })

    it('should have Text component', async () => {
      const textPath = path.join(BUILD_DIR, 'components', 'Text.js')
      expect(existsSync(textPath)).toBe(true)

      const content = await fs.readFile(textPath, 'utf8')
      expect(content).toMatch(/export\s+default/)
    })

    it('should have all hooks', async () => {
      const hooks = [
        'use-app',
        'use-focus',
        'use-focus-manager',
        'use-input',
        'use-stderr',
        'use-stdin',
        'use-stdout',
      ]

      for (const hook of hooks) {
        const hookPath = path.join(BUILD_DIR, 'hooks', `${hook}.js`)
        expect(existsSync(hookPath), `Hook ${hook} should exist`).toBe(true)

        const content = await fs.readFile(hookPath, 'utf8')
        // Hooks should export a default function.
        expect(content).toMatch(/export\s+default/)
      }
    })

    it('should have measureElement module', async () => {
      const measurePath = path.join(BUILD_DIR, 'measure-element.js')
      expect(existsSync(measurePath)).toBe(true)

      const content = await fs.readFile(measurePath, 'utf8')
      expect(content).toMatch(/export\s+default/)
    })

    it('should have index.js with all expected exports', async () => {
      const indexPath = path.join(BUILD_DIR, 'index.js')
      expect(existsSync(indexPath)).toBe(true)

      const content = await fs.readFile(indexPath, 'utf8')
      // Verify upstream ink's public API is exported.
      const expectedExports = [
        'render',
        'Box',
        'Text',
        'Static',
        'Transform',
        'Newline',
        'Spacer',
        'useInput',
        'useApp',
        'useStdin',
        'useStdout',
        'useStderr',
        'useFocus',
        'useFocusManager',
        'measureElement',
      ]

      for (const exp of expectedExports) {
        expect(content).toMatch(new RegExp(`export.*${exp}`))
      }
    })
  })

  describe('ink internal modules structure', () => {
    // Test critical internal modules file structure and content patterns.

    it('should have dom module with createNode export', async () => {
      const domPath = path.join(BUILD_DIR, 'dom.js')
      expect(existsSync(domPath)).toBe(true)

      const content = await fs.readFile(domPath, 'utf8')
      // createNode is the factory function for ink's DOM nodes.
      expect(content).toMatch(/export.*createNode/)
      // Should use yoga-sync for layout.
      expect(content).toMatch(/yoga-sync\.mjs/)
      // Should create Yoga nodes for layout.
      expect(content).toMatch(/Yoga\.Node\.create/)
    })

    it('should have styles module with yoga integration', async () => {
      const stylesPath = path.join(BUILD_DIR, 'styles.js')
      expect(existsSync(stylesPath)).toBe(true)

      const stylesModule = await import(stylesPath)
      // applyStyles is used to convert style props to yoga layout properties.
      expect(stylesModule.default).toBeDefined()
      expect(typeof stylesModule.default).toBe('function')
    })

    it('should have reconciler module', async () => {
      const reconcilerPath = path.join(BUILD_DIR, 'reconciler.js')
      expect(existsSync(reconcilerPath)).toBe(true)

      const content = await fs.readFile(reconcilerPath, 'utf8')
      // Reconciler should use react-reconciler.
      expect(content).toMatch(/react-reconciler/)
      // Should have our devtools disabled patch.
      expect(content).toMatch(/devtools.*disabled|no-op/i)
    })
  })

  describe('yoga-sync content verification', () => {
    // Additional verification that yoga-sync.mjs contains expected patterns.

    it('should have embedded WASM as base64', async () => {
      const yogaSyncPath = path.join(BUILD_DIR, 'yoga-sync.mjs')
      const content = await fs.readFile(yogaSyncPath, 'utf8')

      // Should have base64-encoded WASM data.
      expect(content).toMatch(/[A-Za-z0-9+/]{100,}/)
      // Should export default.
      expect(content).toMatch(/export\s+default/)
    })

    it('should have wrapAssembly wrapper inlined', async () => {
      const yogaSyncPath = path.join(BUILD_DIR, 'yoga-sync.mjs')
      const content = await fs.readFile(yogaSyncPath, 'utf8')

      // wrapAssembly function should be inlined.
      expect(content).toMatch(/wrapAssembly/)
      // Should have Node.create pattern from wrapper.
      expect(content).toMatch(/Node/)
      expect(content).toMatch(/create/)
    })

    it('should have YGEnums constants inlined', async () => {
      const yogaSyncPath = path.join(BUILD_DIR, 'yoga-sync.mjs')
      const content = await fs.readFile(yogaSyncPath, 'utf8')

      // Should have flat enum constants from YGEnums.
      expect(content).toMatch(/DIRECTION_LTR/)
      expect(content).toMatch(/FLEX_DIRECTION_ROW/)
      expect(content).toMatch(/ALIGN_CENTER/)
    })
  })

  describe('upstream-inspired smoke tests', () => {
    // These tests are inspired by ink's upstream test suite and exercise
    // the yoga-sync integration through ink's style/layout system.
    // Reference: https://github.com/vadimdemedes/ink/tree/v6.3.1/test

    it('should apply flex direction styles via applyStyles', async () => {
      // Inspired by upstream: test/flex-direction.tsx
      const stylesPath = path.join(BUILD_DIR, 'styles.js')
      const yogaSyncPath = path.join(BUILD_DIR, 'yoga-sync.mjs')

      const stylesModule = await import(stylesPath)
      const yogaModule = await import(yogaSyncPath)
      const Yoga = yogaModule.default
      const applyStyles = stylesModule.default

      // Create a yoga node and apply flexDirection style.
      const node = Yoga.Node.create()

      // Apply row direction (like <Box flexDirection="row">).
      applyStyles(node, { flexDirection: 'row' })
      expect(node.getFlexDirection()).toBe(Yoga.FLEX_DIRECTION_ROW)

      // Apply column direction (like <Box flexDirection="column">).
      applyStyles(node, { flexDirection: 'column' })
      expect(node.getFlexDirection()).toBe(Yoga.FLEX_DIRECTION_COLUMN)

      node.free()
    })

    it('should apply width and height styles via applyStyles', async () => {
      // Inspired by upstream: test/width-height.tsx
      const stylesPath = path.join(BUILD_DIR, 'styles.js')
      const yogaSyncPath = path.join(BUILD_DIR, 'yoga-sync.mjs')

      const stylesModule = await import(stylesPath)
      const yogaModule = await import(yogaSyncPath)
      const Yoga = yogaModule.default
      const applyStyles = stylesModule.default

      const node = Yoga.Node.create()

      // Apply fixed width/height (like <Box width={10} height={5}>).
      applyStyles(node, { width: 10, height: 5 })
      node.calculateLayout()

      expect(node.getComputedWidth()).toBe(10)
      expect(node.getComputedHeight()).toBe(5)

      node.free()
    })

    it('should apply padding styles via applyStyles', async () => {
      // Inspired by upstream: test/padding.tsx
      const stylesPath = path.join(BUILD_DIR, 'styles.js')
      const yogaSyncPath = path.join(BUILD_DIR, 'yoga-sync.mjs')

      const stylesModule = await import(stylesPath)
      const yogaModule = await import(yogaSyncPath)
      const Yoga = yogaModule.default
      const applyStyles = stylesModule.default

      const node = Yoga.Node.create()

      // Apply padding (like <Box padding={2}>).
      applyStyles(node, { width: 20, height: 10, padding: 2 })
      node.calculateLayout()

      // Padding should be applied on all sides.
      expect(node.getComputedPadding(Yoga.EDGE_TOP)).toBe(2)
      expect(node.getComputedPadding(Yoga.EDGE_RIGHT)).toBe(2)
      expect(node.getComputedPadding(Yoga.EDGE_BOTTOM)).toBe(2)
      expect(node.getComputedPadding(Yoga.EDGE_LEFT)).toBe(2)

      node.free()
    })

    it('should apply margin styles via applyStyles', async () => {
      // Inspired by upstream: test/margin.tsx
      const stylesPath = path.join(BUILD_DIR, 'styles.js')
      const yogaSyncPath = path.join(BUILD_DIR, 'yoga-sync.mjs')

      const stylesModule = await import(stylesPath)
      const yogaModule = await import(yogaSyncPath)
      const Yoga = yogaModule.default
      const applyStyles = stylesModule.default

      const parent = Yoga.Node.create()
      const child = Yoga.Node.create()

      parent.insertChild(child, 0)

      // Apply margin to child (like <Box margin={3}>).
      applyStyles(parent, { width: 50, height: 30 })
      applyStyles(child, { width: 10, height: 5, margin: 3 })
      parent.calculateLayout()

      // Child should be positioned with margin offset.
      expect(child.getComputedLeft()).toBe(3)
      expect(child.getComputedTop()).toBe(3)

      child.free()
      parent.free()
    })

    it('should apply align items styles via applyStyles', async () => {
      // Inspired by upstream: test/flex-align-items.tsx
      const stylesPath = path.join(BUILD_DIR, 'styles.js')
      const yogaSyncPath = path.join(BUILD_DIR, 'yoga-sync.mjs')

      const stylesModule = await import(stylesPath)
      const yogaModule = await import(yogaSyncPath)
      const Yoga = yogaModule.default
      const applyStyles = stylesModule.default

      const parent = Yoga.Node.create()
      const child = Yoga.Node.create()

      parent.insertChild(child, 0)

      // Apply alignItems center (like <Box alignItems="center">).
      applyStyles(parent, { width: 20, height: 10, alignItems: 'center' })
      applyStyles(child, { width: 6, height: 2 })
      parent.calculateLayout()

      // Child should be centered horizontally (default column direction).
      // Center = (20 - 6) / 2 = 7
      expect(child.getComputedLeft()).toBe(7)

      child.free()
      parent.free()
    })

    it('should apply justify content styles via applyStyles', async () => {
      // Inspired by upstream: test/flex-justify-content.tsx
      const stylesPath = path.join(BUILD_DIR, 'styles.js')
      const yogaSyncPath = path.join(BUILD_DIR, 'yoga-sync.mjs')

      const stylesModule = await import(stylesPath)
      const yogaModule = await import(yogaSyncPath)
      const Yoga = yogaModule.default
      const applyStyles = stylesModule.default

      const parent = Yoga.Node.create()
      const child = Yoga.Node.create()

      parent.insertChild(child, 0)

      // Apply justifyContent center (like <Box justifyContent="center">).
      applyStyles(parent, { width: 20, height: 10, justifyContent: 'center' })
      applyStyles(child, { width: 6, height: 2 })
      parent.calculateLayout()

      // Child should be centered vertically (default column direction).
      // Center = (10 - 2) / 2 = 4
      expect(child.getComputedTop()).toBe(4)

      child.free()
      parent.free()
    })
  })
})
