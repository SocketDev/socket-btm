/**
 * Required-files manifest for an OpenTUI install.
 *
 * OpenTUI's Zig build produces a Node-API native binding (`.node`)
 * per platform-arch. The single artifact is the only required file
 * for the prebuilt-asset lookup path.
 */
export const OPENTUI_REQUIRED_FILES = ['opentui.node']
