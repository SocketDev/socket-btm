/**
 * @file Socket-btm repo-local oxlint plugin. Rules that are specific to
 *   this repo's build pipeline and don't belong in the fleet plugin (e.g.
 *   gyp/gypi path-prefix invariants, additions/source-patched conventions).
 *   Wiring: `.config/oxlintrc.json` lists this alongside the fleet plugin in
 *   `jsPlugins`. Rules are registered with the `repo/` key prefix so they
 *   reference as `socket/repo/<name>` in oxlintrc (same `meta.name` as the
 *   fleet plugin; oxlint merges rule maps under the shared namespace).
 *   Fleet rules live in the wheelhouse-cascaded `.config/oxlint-plugin/` and
 *   reference as `socket/<name>`. Never put fleet-relevant rules here — they
 *   belong in `socket-wheelhouse/template/.config/oxlint-plugin/`.
 */

const plugin = {
  meta: {
    name: 'socket',
    version: '0.1.0',
  },
  rules: {
    // Empty for now. First btm-local rule lands as `'repo/<name>': <ruleDef>`.
  },
}

export default plugin
