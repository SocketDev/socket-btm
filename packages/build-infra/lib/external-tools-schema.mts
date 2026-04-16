/**
 * Zod schema for external-tools.json files.
 *
 * Validates tool configuration used by the tool-installer to auto-download
 * and verify external build dependencies.
 *
 * Normalized schema across all Socket repos:
 *   socket-btm: build tools (system tools, pip packages)
 *   socket-cli: bundle tools (npm packages, GitHub release binaries)
 *   socket-registry: CI tools (GitHub release binaries)
 *   ultrathink: build tools (compilers, language toolchains)
 */

import { z } from 'zod'

const toolSchema = z
  .object({
    // Common fields (all repos).
    description: z.string().optional().describe('What the tool is used for'),
    version: z
      .string()
      .optional()
      .describe('Version requirement (exact "0.15.2" or range "3.28+")'),
    packageManager: z
      .enum(['npm', 'pip', 'pnpm'])
      .optional()
      .describe('Package manager for installation. Absent = system tool'),
    notes: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Additional notes about the tool'),

    // GitHub release fields (socket-cli bundle-tools, socket-registry).
    repository: z
      .string()
      .optional()
      .describe('Repository in "github:owner/repo" format'),
    release: z
      .enum(['asset', 'archive'])
      .optional()
      .describe(
        'Release type: "asset" for individual binaries, "archive" for source tarballs',
      ),
    tag: z
      .string()
      .optional()
      .describe('Release tag (when different from version)'),
    checksums: z
      .record(
        z.string(),
        z.union([
          // Platform-keyed: { "darwin-arm64": { "asset": "file.tar.gz", "sha256": "abc..." } }
          z.object({
            asset: z.string(),
            sha256: z.string(),
          }),
          // Flat: { "file.tar.gz": "abc..." } (legacy/simple)
          z.string(),
        ]),
      )
      .optional()
      .describe('Checksums keyed by platform or asset filename'),

    // npm package fields (socket-cli bundle-tools).
    integrity: z
      .string()
      .optional()
      .describe('npm package integrity hash (sha512)'),
    npm: z
      .object({
        package: z.string().optional(),
        version: z.string().optional(),
      })
      .optional()
      .describe(
        'Nested npm package reference (when tool has both binary and npm forms)',
      ),
  })
  .passthrough()

export const externalToolsSchema = z
  .object({
    $schema: z.string().optional(),
    description: z
      .string()
      .optional()
      .describe('Human-readable description of this config file'),
    extends: z
      .string()
      .optional()
      .describe('Path to a base external-tools.json to inherit tools from'),
    tools: z
      .record(z.string(), toolSchema)
      .optional()
      .describe('Map of tool name to tool configuration'),
  })
  .passthrough()

/**
 * Validate an external-tools.json object against the schema.
 * @param {unknown} data - Parsed JSON data
 * @returns {{ success: true, data: object } | { success: false, error: import('zod').ZodError }}
 */
export function validateExternalTools(data) {
  return externalToolsSchema.safeParse(data)
}
