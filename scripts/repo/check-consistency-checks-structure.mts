/**
 * @file Checks 5-8 for check-consistency.mts: external-tools.json,
 *   build output structure, package.json structure, and workspace
 *   dependencies. Split out of the main checker so the orchestration file
 *   stays under the file-size cap.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { errorMessage } from 'build-infra/lib/error-utils'
import { getFinalOutputDir } from 'build-infra/lib/paths'

import { colors, log, reportIssue } from './check-consistency-state.mts'
import type {
  JsonObject,
  PackageInfo,
  PackageJson,
} from './check-consistency-state.mts'

// ============================================================================
// Check 5: External Tools Documentation
// ============================================================================

// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export async function checkExternalTools(
  packages: PackageInfo[],
): Promise<void> {
  log('[5/8] Checking external-tools.json…', colors.blue)

  const C_PACKAGES: string[] = [
    'binflate',
    'binpress',
    'binject',
    'bin-infra',
    'bin-stub-builder',
  ]

  for (let i = 0, { length } = C_PACKAGES; i < length; i += 1) {
    const pkgName = C_PACKAGES[i]
    const pkg = packages.find(p => p.name === pkgName)
    if (!pkg) {
      continue
    }

    const externalToolsPath = path.join(pkg.path, 'external-tools.json')

    if (!existsSync(externalToolsPath)) {
      reportIssue(
        'warning',
        'external-tools',
        'Missing external-tools.json (expected for C packages)',
        `${pkg.name}/external-tools.json`,
      )
      continue
    }

    // Validate schema
    try {
      const tools = JSON.parse(
        await fs.readFile(externalToolsPath, 'utf8'),
      ) as {
        $schema?: string | undefined
        tools?: JsonObject | undefined
      }

      if (!tools.$schema) {
        reportIssue(
          'error',
          'external-tools',
          'Missing $schema in external-tools.json',
          `${pkg.name}/external-tools.json`,
        )
      }

      if (!tools.tools || typeof tools.tools !== 'object') {
        reportIssue(
          'error',
          'external-tools',
          'Missing or invalid tools object',
          `${pkg.name}/external-tools.json`,
        )
      }
    } catch (e) {
      reportIssue(
        'error',
        'external-tools',
        `Invalid JSON: ${errorMessage(e)}`,
        `${pkg.name}/external-tools.json`,
      )
    }
  }
}

// ============================================================================
// Check 6: Build Output Structure
// ============================================================================

// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export async function checkBuildOutputStructure(
  packages: PackageInfo[],
): Promise<void> {
  log('[6/8] Checking build output structure…', colors.blue)

  for (
    let pkgIndex = 0, { length: pkgCount } = packages;
    pkgIndex < pkgCount;
    pkgIndex += 1
  ) {
    const pkg = packages[pkgIndex]!
    const buildDir = path.join(pkg.path, 'build')

    if (!existsSync(buildDir)) {
      reportIssue(
        'info',
        'build-output',
        'No build directory (may not have been built yet)',
        `${pkg.name}/build`,
      )
      continue
    }

    // Four valid layouts:
    //   1. node-smol style:  build/{mode}/out/Final/                       (single-platform per build)
    //   2. binsuite style:   build/{mode}/{platform-arch}/out/Final/       (per-platform subdir)
    //   3. wasm style:       build/{mode}/{platform-arch}/wasm/out/Final/  (yoga-layout-builder, onnxruntime-builder)
    //   4. native-addon style: build/{mode}/{platform-arch}/out/{platform-arch}/<name>.node (opentui-builder)
    //
    // A "Final" directory or per-arch addon directory under build/{mode}/** counts as built.

    // Special case: model builders use different structure
    const MODEL_BUILDERS: string[] = ['codet5-models-builder', 'minilm-builder']
    if (MODEL_BUILDERS.includes(pkg.name)) {
      // Model builders have intentional deviations
      continue
    }

    const hasFinalUnder = async (modeDir: string): Promise<boolean> => {
      // Cheap: check direct out/Final first (node-smol style).
      if (existsSync(getFinalOutputDir(modeDir))) {
        return true
      }
      // Fall back to per-platform subdirs (binsuite, wasm, and native-addon styles).
      const entries = await fs.readdir(modeDir, { withFileTypes: true })
      for (
        let entryIndex = 0, { length: entryCount } = entries;
        entryIndex < entryCount;
        entryIndex += 1
      ) {
        const entry = entries[entryIndex]!
        if (!entry.isDirectory()) {
          continue
        }
        const archDir = path.join(modeDir, entry.name)
        // binsuite style: build/{mode}/{platform-arch}/out/Final/
        if (existsSync(getFinalOutputDir(archDir))) {
          return true
        }
        // wasm style: build/{mode}/{platform-arch}/wasm/out/Final/
        if (existsSync(getFinalOutputDir(path.join(archDir, 'wasm')))) {
          return true
        }
        // native-addon style: build/{mode}/{platform-arch}/out/{platform-arch}/
        // (opentui-builder writes the .node binary into a
        // platform-arch subdir of out/, no Final/ segment).
        if (existsSync(path.join(archDir, 'out', entry.name))) {
          return true
        }
      }
      return false
    }

    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const mode of ['dev', 'prod'] as const) {
      const modeDir = path.join(buildDir, mode)
      if (!existsSync(modeDir)) {
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      if (!(await hasFinalUnder(modeDir))) {
        reportIssue(
          'warning',
          'build-output',
          `${mode} build exists but missing recognized output dir (expected build/${mode}/out/Final, build/${mode}/<platform-arch>/out/Final, build/${mode}/<platform-arch>/wasm/out/Final, or build/${mode}/<platform-arch>/out/<platform-arch>/)`,
          `${pkg.name}/build/${mode}`,
        )
      }
    }
  }
}

// ============================================================================
// Check 7: Package.json Structure
// ============================================================================

// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export async function checkPackageJsonStructure(
  packages: PackageInfo[],
): Promise<void> {
  log('[7/8] Checking package.json structure…', colors.blue)

  for (let i = 0, { length } = packages; i < length; i += 1) {
    const pkg = packages[i]!
    const { description, license, name, scripts, type, version } = pkg.pkgJson
    const pkgJsonPath = path.join(pkg.path, 'package.json')

    if (!name) {
      reportIssue(
        'error',
        'package-json',
        'Missing name field',
        `${pkg.name}/package.json`,
      )
    }

    if (!version) {
      reportIssue(
        'error',
        'package-json',
        'Missing version field',
        `${pkg.name}/package.json`,
      )
    }

    if (!description) {
      reportIssue(
        'warning',
        'package-json',
        'Missing description field',
        `${pkg.name}/package.json`,
      )
    }

    if (!license) {
      reportIssue(
        'warning',
        'package-json',
        'Missing license field',
        `${pkg.name}/package.json`,
        async () => {
          const content = await fs.readFile(pkgJsonPath, 'utf8')
          const json = JSON.parse(content) as PackageJson
          json.license = 'MIT'
          await fs.writeFile(
            pkgJsonPath,
            `${JSON.stringify(json, undefined, 2)}\n`,
            'utf8',
          )
          return 'Added license: "MIT"'
        },
      )
    }

    // Check for private field
    if (pkg.pkgJson.private === undefined) {
      reportIssue(
        'warning',
        'package-json',
        'Missing private field (should be true for internal packages)',
        `${pkg.name}/package.json`,
        async () => {
          const content = await fs.readFile(pkgJsonPath, 'utf8')
          const json = JSON.parse(content) as PackageJson
          json.private = true
          await fs.writeFile(
            pkgJsonPath,
            `${JSON.stringify(json, undefined, 2)}\n`,
            'utf8',
          )
          return 'Added private: true'
        },
      )
    }

    if (type !== 'module') {
      reportIssue(
        'error',
        'package-json',
        'Must use type: "module" (ESM)',
        `${pkg.name}/package.json`,
      )
    }

    // Check for clean script (all packages should have it)
    if (!scripts || !scripts['clean']) {
      reportIssue(
        'warning',
        'package-json',
        'Missing clean script',
        `${pkg.name}/package.json`,
        async () => {
          const content = await fs.readFile(pkgJsonPath, 'utf8')
          const json = JSON.parse(content) as PackageJson
          if (!json.scripts) {
            json.scripts = {}
          }
          // Infer clean script based on package type
          const hasNodeGyp = existsSync(path.join(pkg.path, 'binding.gyp'))
          // Use cross-platform Node.js fs.rmSync instead of rm -rf
          const cleanDirs = hasNodeGyp
            ? ['build']
            : ['build', 'dist', 'coverage', '.turbo']
          const rmCommand = `node -e "['${cleanDirs.join("','")}'].forEach(d=>require('fs').rmSync(d,{recursive:true,force:true}))"`
          json.scripts['clean'] = hasNodeGyp
            ? `node-gyp clean && ${rmCommand}`
            : rmCommand
          await fs.writeFile(
            pkgJsonPath,
            `${JSON.stringify(json, undefined, 2)}\n`,
            'utf8',
          )
          return `Added clean script: "${json.scripts['clean']}"`
        },
      )
    }
  }
}

// ============================================================================
// Check 8: Workspace Dependencies
// ============================================================================

// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export async function checkWorkspaceDependencies(
  packages: PackageInfo[],
): Promise<void> {
  log('[8/8] Checking workspace dependencies…', colors.blue)

  for (let i = 0, { length } = packages; i < length; i += 1) {
    const pkg = packages[i]!
    const { dependencies = {}, devDependencies = {} } = pkg.pkgJson
    const allDeps = { ...dependencies, ...devDependencies }
    const pkgJsonPath = path.join(pkg.path, 'package.json')

    // Find internal dependencies
    const internalDeps = Object.entries(allDeps).filter(([depName]) =>
      packages.some(p => p.name === depName),
    )

    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
    for (const [depName, version] of internalDeps) {
      if (version !== 'workspace:*') {
        reportIssue(
          'error',
          'workspace-deps',
          `Internal dependency "${depName}" must use "workspace:*", got "${version}"`,
          `${pkg.name}/package.json`,
          async () => {
            const content = await fs.readFile(pkgJsonPath, 'utf8')
            const json = JSON.parse(content) as PackageJson

            // Fix in both dependencies and devDependencies
            if (json.dependencies?.[depName]) {
              json.dependencies[depName] = 'workspace:*'
            }
            if (json.devDependencies?.[depName]) {
              json.devDependencies[depName] = 'workspace:*'
            }

            await fs.writeFile(
              pkgJsonPath,
              `${JSON.stringify(json, undefined, 2)}\n`,
              'utf8',
            )
            return `Fixed "${depName}" to use workspace:*`
          },
        )
      }
    }

    // Check for catalog usage
    const catalogDeps = Object.entries(allDeps).filter(
      ([, version]) => version === 'catalog:',
    )

    if (catalogDeps.length > 0) {
      // Verify catalog entries exist in pnpm-workspace.yaml
      // (This is a simplified check - full validation would parse YAML)
      reportIssue(
        'info',
        'workspace-deps',
        `Uses ${catalogDeps.length} catalog dependencies`,
        `${pkg.name}/package.json`,
      )
    }
  }
}
