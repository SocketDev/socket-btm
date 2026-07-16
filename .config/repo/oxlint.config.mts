/**
 * @file Repo oxlint overlay. Imports the fleet factory and augments only
 *   `ignorePatterns` with socket-btm's own verbatim trees — the same trees the
 *   sibling `.config/repo/.prettierignore` overlay already excludes from oxfmt.
 *   `additions/source-patched/**` is Node-internal source synced
 *   byte-faithfully into the smol Node build; it mirrors Node's lib/internal
 *   structure + style, not socket's, so socket/ rules (sort-source-methods,
 *   no-top-level-await, …) must not touch it. Without this overlay oxlint scans
 *   that tree and floods the pre-push `--all` gate with ~600 findings the oxfmt
 *   side already excludes — an asymmetry between the two tools, not real debt.
 *   The fleet config's own `ignorePatterns` already cover `**∕test/fixtures`
 *   and `**∕dist`, so only the source-patched tree needs adding here.
 */

import { defineConfig } from 'oxlint'

import { config } from '../fleet/oxlint.config.mts'

// oxlint-disable-next-line socket/no-default-export -- oxlint loads the config from this module's default export.
export default defineConfig(
  config({
    ignorePatterns: [
      '**/additions/source-patched/**',
      'additions/source-patched/**',
    ],
  }),
)
