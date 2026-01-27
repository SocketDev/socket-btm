import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  convertIgnorePatternToMinimatch,
  includeIgnoreFile,
} from '@eslint/compat'
import jsPlugin from '@eslint/js'
import { flatConfigs as origImportXFlatConfigs } from 'eslint-plugin-import-x'
import nodePlugin from 'eslint-plugin-n'
import sortDestructureKeysPlugin from 'eslint-plugin-sort-destructure-keys'
import unicornPlugin from 'eslint-plugin-unicorn'
import globals from 'globals'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

// Get maintained Node versions
const getMaintainedNodeVersions = () => ['18', '20', '22', '24', '25']

const rootPath = path.dirname(__dirname)

const nodeVersion = readFileSync(path.join(rootPath, '.node-version'), 'utf8')

const nodeGlobalsConfig = Object.fromEntries(
  Object.entries(globals.node).map(([k]) => [k, 'readonly']),
)

const biomeConfigPath = path.join(rootPath, 'biome.json')
const biomeConfig = require(biomeConfigPath)
const biomeIgnores = {
  name: 'Imported biome.json ignore patterns',
  ignores: biomeConfig.files.includes
    .filter(p => p.startsWith('!'))
    .map(p => convertIgnorePatternToMinimatch(p.slice(1))),
}

const gitignorePath = path.join(rootPath, '.gitignore')
const gitIgnores = {
  ...includeIgnoreFile(gitignorePath),
  name: 'Imported .gitignore ignore patterns',
}

const sharedPlugins = {
  ...nodePlugin.configs['flat/recommended-script'].plugins,
  'sort-destructure-keys': sortDestructureKeysPlugin,
  unicorn: unicornPlugin,
}

const sharedRules = {
  'n/exports-style': ['error', 'module.exports'],
  'n/no-missing-require': ['off'],
  'n/no-process-exit': 'error',
  'n/no-unpublished-bin': 'error',
  'n/no-unsupported-features/es-builtins': 'error',
  'n/no-unsupported-features/es-syntax': [
    'error',
    {
      ignores: ['promise-withresolvers'],
      version: getMaintainedNodeVersions().current,
    },
  ],
  'n/no-unsupported-features/node-builtins': [
    'error',
    {
      ignores: [
        'test',
        'test.describe',
        'ReadableStream',
        'events.getMaxListeners',
      ],
      version: `>=${nodeVersion}`,
    },
  ],
  'n/prefer-node-protocol': 'error',
  'unicorn/consistent-function-scoping': 'error',
  curly: 'error',
  'line-comment-position': ['error', { position: 'above' }],
  'no-await-in-loop': 'error',
  'no-control-regex': 'off',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-new': 'error',
  'no-proto': 'error',
  'no-undef': 'error',
  'no-unexpected-multiline': 'off',
  'no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_|^this$',
      ignoreRestSiblings: true,
      varsIgnorePattern: '^_',
    },
  ],
  'no-var': 'error',
  'no-warning-comments': ['warn', { terms: ['fixme'] }],
  'prefer-const': 'error',
  'sort-destructure-keys/sort-destructure-keys': 'error',
  'sort-imports': 'off',
}

const sharedRulesForImportX = {
  ...origImportXFlatConfigs.recommended.rules,
  'import-x/extensions': [
    'error',
    'never',
    {
      cjs: 'ignorePackages',
      js: 'ignorePackages',
      json: 'always',
      mjs: 'ignorePackages',
    },
  ],
  'import-x/no-unresolved': [
    'error',
    {
      // Ignore @socketsecurity subpaths and build-infra - resolved by runtime loader
      ignore: ['^@socketsecurity/', '^build-infra/'],
    },
  ],
  'import-x/order': [
    'warn',
    {
      groups: [
        'builtin',
        'external',
        'internal',
        ['parent', 'sibling', 'index'],
        'type',
      ],
      pathGroups: [
        {
          pattern: '@socket{registry,security}/**',
          group: 'internal',
        },
      ],
      pathGroupsExcludedImportTypes: ['type'],
      'newlines-between': 'always',
      alphabetize: {
        order: 'asc',
      },
    },
  ],
}

function getImportXFlatConfigs(isEsm) {
  return {
    recommended: {
      ...origImportXFlatConfigs.recommended,
      languageOptions: {
        ...origImportXFlatConfigs.recommended.languageOptions,
        ecmaVersion: 'latest',
        sourceType: isEsm ? 'module' : 'script',
      },
      rules: {
        ...sharedRulesForImportX,
        'import-x/no-named-as-default-member': 'off',
      },
    },
    typescript: {
      ...origImportXFlatConfigs.typescript,
      plugins: origImportXFlatConfigs.recommended.plugins,
      settings: {
        ...origImportXFlatConfigs.typescript.settings,
      },
      rules: {
        ...sharedRulesForImportX,
        // TypeScript compilation already ensures that named imports exist in
        // the referenced module.
        'import-x/named': 'off',
        'import-x/no-named-as-default-member': 'off',
        'import-x/no-unresolved': 'off',
      },
    },
  }
}

const importFlatConfigsForScript = getImportXFlatConfigs(false)
const importFlatConfigsForModule = getImportXFlatConfigs(true)

export default [
  biomeIgnores,
  gitIgnores,
  {
    ignores: [
      // Dot folders.
      '.*/**',
      // Nested directories.
      '**/build/**',
      '**/coverage/**',
      '**/dist/**',
      '**/external/**',
      '**/node_modules/**',
      '**/upstream/**',
      // Generated files.
      '**/*.d.ts',
      '**/*.d.ts.map',
      '**/*.tsbuildinfo',
    ],
  },
  {
    files: ['**/*.{cjs,js}'],
    ...jsPlugin.configs.recommended,
    ...importFlatConfigsForScript.recommended,
    ...nodePlugin.configs['flat/recommended-script'],
    languageOptions: {
      ...jsPlugin.configs.recommended.languageOptions,
      ...importFlatConfigsForModule.recommended.languageOptions,
      ...nodePlugin.configs['flat/recommended-script'].languageOptions,
      globals: {
        ...jsPlugin.configs.recommended.languageOptions?.globals,
        ...importFlatConfigsForModule.recommended.languageOptions?.globals,
        ...nodePlugin.configs['flat/recommended-script'].languageOptions
          ?.globals,
        ...nodeGlobalsConfig,
      },
    },
    plugins: {
      ...jsPlugin.configs.recommended.plugins,
      ...importFlatConfigsForScript.recommended.plugins,
      ...sharedPlugins,
    },
    rules: {
      ...jsPlugin.configs.recommended.rules,
      ...importFlatConfigsForScript.recommended.rules,
      ...nodePlugin.configs['flat/recommended-script'].rules,
      ...sharedRules,
    },
  },
  {
    files: ['**/*.mjs'],
    ...jsPlugin.configs.recommended,
    ...importFlatConfigsForModule.recommended,
    languageOptions: {
      ...jsPlugin.configs.recommended.languageOptions,
      ...importFlatConfigsForModule.recommended.languageOptions,
      globals: {
        ...jsPlugin.configs.recommended.languageOptions?.globals,
        ...importFlatConfigsForModule.recommended.languageOptions?.globals,
        ...nodeGlobalsConfig,
      },
      sourceType: 'module',
    },
    plugins: {
      ...jsPlugin.configs.recommended.plugins,
      ...importFlatConfigsForModule.recommended.plugins,
      ...sharedPlugins,
    },
    rules: {
      ...jsPlugin.configs.recommended.rules,
      ...importFlatConfigsForModule.recommended.rules,
      ...sharedRules,
      'n/hashbang': 'error',
    },
  },
  {
    // Relax rules for script files.
    files: ['**/scripts/**/*.{cjs,mjs}'],
    rules: {
      'n/hashbang': 'off',
      'n/no-process-exit': 'off',
      'no-await-in-loop': 'off',
    },
  },
]
