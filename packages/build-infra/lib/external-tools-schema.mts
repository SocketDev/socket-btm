/**
 * TypeBox schema for external-tools.json files.
 *
 * Validates tool configuration used by the tool-installer to auto-download and
 * verify external build dependencies.
 *
 * Normalized schema across all Socket repos: socket-btm: build tools (system
 * tools, pip packages) socket-cli: bundle tools (npm packages, GitHub release
 * binaries) socket-registry: CI tools (GitHub release binaries) ultrathink:
 * build tools (compilers, language toolchains)
 */

import { Type } from '@sinclair/typebox'

import { validateSchema } from '@socketsecurity/lib-stable/schema/validate'

import type { Static } from '@sinclair/typebox'

const toolSchema = Type.Object(
  {
    // Common fields (all repos).
    description: Type.Optional(
      Type.String({ description: 'What the tool is used for' }),
    ),
    version: Type.Optional(
      Type.String({
        description: 'Version requirement (exact "0.15.2" or range "3.28+")',
      }),
    ),
    published: Type.Optional(
      Type.String({
        description:
          'Publish date (ISO-8601 YYYY-MM-DD). Source-of-truth for the soak policy in lib/soak-policy.mts. Required when adding a pin inside the 7-day soak window.',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      }),
    ),
    packageManager: Type.Optional(
      Type.Union(
        [Type.Literal('npm'), Type.Literal('pip'), Type.Literal('pnpm')],
        {
          description: 'Package manager for installation. Absent = system tool',
        },
      ),
    ),
    notes: Type.Optional(
      Type.Union([Type.String(), Type.Array(Type.String())], {
        description: 'Additional notes about the tool',
      }),
    ),
    extras: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Python package extras (pip optional dependencies), e.g. ["onnx"] for a torch[onnx] install spec',
      }),
    ),

    // GitHub release fields (socket-cli bundle-tools, socket-registry).
    repository: Type.Optional(
      Type.String({ description: 'Repository in "github:owner/repo" format' }),
    ),
    release: Type.Optional(
      Type.Union([Type.Literal('asset'), Type.Literal('archive')], {
        description:
          'Release type: "asset" for individual binaries, "archive" for source tarballs',
      }),
    ),
    tag: Type.Optional(
      Type.String({ description: 'Release tag (when different from version)' }),
    ),
    // Per-platform asset map. The CANONICAL fleet shape. Each platform
    // pins the asset filename + an SRI integrity string (sha256-<base64>).
    // Decode the base64 segment to hex for `sha256sum -c` verification.
    // Replaces the legacy `checksums: { <platform>: { asset, sha256: <hex> } }`
    // shape — fleet rule is integrity-over-checksum.
    platforms: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Object({
          asset: Type.String(),
          integrity: Type.String({
            description:
              'SRI hash (sha256-<base64>). Use checksumToIntegrity/integrityToChecksum from @socketsecurity/lib/integrity to convert if a hex digest is all you have.',
            pattern: '^sha(256|384|512)-[A-Za-z0-9+/]+=*$',
          }),
          source: Type.Optional(Type.String()),
          binary: Type.Optional(Type.String()),
          notes: Type.Optional(Type.String()),
        }),
        { description: 'Per-platform release assets keyed by <os>-<arch>' },
      ),
    ),

    // npm package fields (socket-cli bundle-tools).
    integrity: Type.Optional(
      Type.String({
        description:
          'npm-package SRI integrity (sha512-<base64>). The npm-registry-returned form.',
      }),
    ),
    npm: Type.Optional(
      Type.Object(
        {
          package: Type.Optional(Type.String()),
          version: Type.Optional(Type.String()),
        },
        {
          description:
            'Nested npm package reference (when tool has both binary and npm forms)',
        },
      ),
    ),
  },
  // TypeBox equivalent of Zod's .passthrough() — allow extra properties.
  { additionalProperties: true },
)

export const externalToolsSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    description: Type.Optional(
      Type.String({
        description: 'Human-readable description of this config file',
      }),
    ),
    extends: Type.Optional(
      Type.Union([Type.String(), Type.Array(Type.String())], {
        description:
          'Path(s) to a base external-tools.json to inherit tools from. Mirrors ESLint: accepts a single string or an array of strings. Later entries in an array override earlier ones; the current file overrides all.',
      }),
    ),
    tools: Type.Optional(
      Type.Record(Type.String(), toolSchema, {
        description: 'Map of tool name to tool configuration',
      }),
    ),
  },
  { additionalProperties: true },
)

/**
 * A single tool entry in an external-tools.json `tools` map.
 */
export type ExternalTool = Static<typeof toolSchema>

/**
 * The full shape of an external-tools.json file.
 */
export type ExternalToolsFile = Static<typeof externalToolsSchema>

/**
 * Validate an external-tools.json object against the schema.
 *
 * @param {unknown} data - Parsed JSON data.
 *
 * @returns `{ ok: true, value }` on success, `{ ok: false, errors }` with
 *   normalized `{ path, message }` issues on failure.
 */
export function validateExternalTools(data: unknown) {
  return validateSchema(externalToolsSchema, data)
}
