/**
 * LZFSE library forwarding header.
 * Provides access to LZFSE compression/decompression via upstream submodule.
 *
 * This is a forwarding header that includes the real lzfse.h from the upstream submodule.
 * The upstream lzfse is a git submodule at: packages/bin-infra/upstream/lzfse
 */

#ifndef SOCKETSECURITY_BIN_INFRA_LZFSE_H
#define SOCKETSECURITY_BIN_INFRA_LZFSE_H

// Forward to the actual lzfse.h from the upstream submodule.
// The path is relative to this file's location:
//   packages/bin-infra/src/socketsecurity/bin-infra/lzfse.h
// Submodule is at: packages/bin-infra/upstream/lzfse
#include "../../../upstream/lzfse/src/lzfse.h"

#endif // SOCKETSECURITY_BIN_INFRA_LZFSE_H
