/**
 * Zod schema for external-tools.json files.
 *
 * Validates tool configuration used by the tool-installer to auto-download
 * and verify external build dependencies.
 */

import { z } from 'zod'

const toolSchema = z
  .object({
    description: z.string().optional().describe('What the tool is used for'),
    version: z
      .string()
      .optional()
      .describe('Version requirement (exact "0.15.2" or range "3.28+")'),
    packageManager: z
      .enum(['pip', 'pnpm'])
      .optional()
      .describe('Package manager for installation. Absent = system tool'),
    notes: z.string().optional().describe('Additional notes about the tool'),
  })
  .strict()

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
      .describe('Map of tool name to tool configuration'),
  })
  .strict()

/**
 * Validate an external-tools.json object against the schema.
 * @param {unknown} data - Parsed JSON data
 * @returns {{ success: true, data: object } | { success: false, error: import('zod').ZodError }}
 */
export function validateExternalTools(data) {
  return externalToolsSchema.safeParse(data)
}
