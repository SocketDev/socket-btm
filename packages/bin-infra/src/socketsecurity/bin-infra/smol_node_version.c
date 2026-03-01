/**
 * Compile-time Node.js version embedding for node-smol binaries.
 *
 * This file embeds the Node.js version string into a dedicated section
 * that can be read by binject without executing the binary.
 *
 * The version is placed in:
 * - Mach-O: SMOL segment, __SMOL_NODE_VER section
 * - ELF: SMOL_NODE_VER section
 * - PE: SMOL_NODE_VER section
 *
 * Uses NODE_VERSION_STRING from node_version.h when compiled as part of Node.js.
 */

#include "socketsecurity/bin-infra/segment_names.h"
#include "node_version.h"

// Use Node.js's built-in version string.
#ifndef NODE_VERSION_STRING
#error "NODE_VERSION_STRING must be defined (from node_version.h)"
#endif

// Place version string in platform-specific section.
#ifdef __APPLE__
// Mach-O: SMOL segment, __SMOL_NODE_VER section
__attribute__((used, section("SMOL,__SMOL_NODE_VER")))
#elif defined(_WIN32)
// PE: Named section (will be converted to resource by linker settings if needed)
#pragma section("SMOL_NODE_VER", read)
__declspec(allocate("SMOL_NODE_VER"))
#else
// ELF: Named section
__attribute__((used, section("SMOL_NODE_VER")))
#endif
static const char smol_embedded_node_version[] = NODE_VERSION_STRING;

// Prevent the compiler from optimizing away the version string.
// This function is never called but prevents dead code elimination.
const char* smol_get_embedded_node_version(void) {
    return smol_embedded_node_version;
}
