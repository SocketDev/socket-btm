// ============================================================================
// sea_inject.h — VFS archive preparation and binary injection
// ============================================================================
//
// WHAT THIS FILE DECLARES
// Functions that prepare VFS archives and inject SEA blobs + VFS data into
// compiled executables using binject-core. This is the "do the injection"
// half of the SEA build process — the other half (config parsing) lives in
// smol_config_parser.h.
//
// WHY IT'S SEPARATE FROM THE PARSER
// Config parsing (reading JSON, validating fields) is conceptually different
// from injection (creating archives, writing binary segments). Keeping them
// in separate files makes each easier to understand and modify independently.
// It also keeps the patch on node_sea_bin.cc minimal — the patch only needs
// to include this one header and call PrepareAndInjectSea().
//
// HOW THE PATCH USES THIS
// The patch on node_sea_bin.cc (008-sea-binject.patch) replaces ~300 lines
// of LIEF injection code with a single call:
//   #include "socketsecurity/sea-smol/sea_inject.h"
//   ...
//   PrepareAndInjectSea(config, sea_config_path, sea_blob);
// ============================================================================

#ifndef SRC_SOCKETSECURITY_SEA_SMOL_SEA_INJECT_H_
#define SRC_SOCKETSECURITY_SEA_SMOL_SEA_INJECT_H_

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "node_sea.h"

namespace node {
namespace sea {

// Prepare a .tar.gz VFS archive from the source path in the config.
// Handles directories (create archive), .tar files (compress), and
// .tar.gz files (use as-is). Returns the archive path, empty string
// for compat mode, or nullopt on error.
std::optional<std::string> PrepareVfsArchive(
    const SmolVfsConfig& vfs_config,
    const std::string& sea_config_path);

// Serialize a VFS config struct to binary blob (SVFG format, 108 bytes).
std::optional<std::vector<uint8_t>> SerializeVfsConfig(
    const SmolVfsConfig& config);

// Low-level: inject SEA blob + VFS archive + config into executable.
// Wraps the binject_batch() C API. Handles temp file creation, cleanup,
// and VFS mode detection (on-disk vs in-memory).
bool InjectSeaAndVfs(const std::string& executable_path,
                     const std::string& output_path,
                     const std::vector<uint8_t>& sea_blob,
                     const std::optional<std::string>& vfs_archive,
                     const std::string& vfs_mode,
                     const std::optional<std::vector<uint8_t>>& vfs_config_blob);

// High-level: orchestrate the full SEA+VFS injection flow.
// 1. If config has smol_vfs: prepare archive + serialize config
// 2. Call InjectSeaAndVfs with all assembled data
// This is the single function the patch calls.
bool PrepareAndInjectSea(const SeaConfig& config,
                         const std::string& sea_config_path,
                         const std::vector<uint8_t>& sea_blob);

}  // namespace sea
}  // namespace node

#endif  // SRC_SOCKETSECURITY_SEA_SMOL_SEA_INJECT_H_
