/**
 * node_sea_smol.h - Socket Security SEA/smol wrapper functions
 *
 * Provides C++ wrapper functions that bridge Node.js SEA build system with
 * Socket Security's binject-core C API for binary injection and VFS creation.
 *
 * These functions wrap the low-level C APIs (smol_config.h, vfs_utils.h,
 * binject.h) to provide idiomatic C++ interfaces that work with Node.js types.
 */

#ifndef SRC_NODE_SEA_SMOL_H_
#define SRC_NODE_SEA_SMOL_H_

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "node_sea.h"
#include "simdjson.h"

namespace node {
namespace sea {

/**
 * Parse "smol" configuration from sea-config.json.
 *
 * Processes the Socket Security "smol" configuration block from sea-config.json
 * and populates the SeaConfig with VFS and update configuration settings.
 *
 * @param smol_object JSON object containing "smol" configuration
 * @param config_path Path to sea-config.json (for error messages)
 * @param result SeaConfig to populate with parsed settings
 * @return true if parsing succeeded, false on error
 */
bool ParseSmolConfig(
    simdjson::ondemand::object& smol_object,
    const std::string& config_path,
    SeaConfig& result);

/**
 * Serialize SmolUpdateConfig to binary format for embedding.
 *
 * Converts the C++ SmolUpdateConfig struct to a 1176-byte SMFG format binary
 * blob that can be embedded in the executable.
 *
 * @param config SmolUpdateConfig struct containing update settings
 * @return Binary data ready for injection, or nullopt on failure
 */
std::optional<std::vector<uint8_t>> SerializeSmolUpdateConfig(
    const SmolUpdateConfig& config);

/**
 * Serializes SmolVfsConfig to binary blob (SVFG format) for embedding.
 *
 * @param config VFS configuration to serialize
 * @return Serialized binary blob (366 bytes), or nullopt on error
 */
std::optional<std::vector<uint8_t>> SerializeVfsConfig(
    const SmolVfsConfig& config);

/**
 * Prepare VFS archive for embedding.
 *
 * Takes a SmolVfsConfig and creates a .tar.gz archive from the specified source.
 * Handles multiple source types (directory, .tar, .tar.gz) and creates temporary
 * archive files as needed.
 *
 * @param vfs_config SmolVfsConfig containing mode and source path
 * @param sea_config_path Path to sea-config.json (for resolving relative paths)
 * @return Path to prepared .tar.gz archive, empty string for compat mode, or
 *         nullopt on error
 */
std::optional<std::string> PrepareVfsArchive(
    const SmolVfsConfig& vfs_config,
    const std::string& sea_config_path);

/**
 * Inject SEA blob and VFS into executable using binject-core.
 *
 * This function wraps the binject_batch() C API and handles all the details of
 * injecting the SEA blob, VFS archive, and SMOL update config into the target
 * executable. It automatically detects the binary format (ELF/Mach-O/PE) and
 * uses the appropriate injection strategy.
 *
 * @param executable_path Path to source executable (node binary)
 * @param output_path Path where injected binary will be written
 * @param sea_blob SEA blob data (JavaScript code + assets)
 * @param vfs_archive Optional path to .tar.gz VFS archive (nullopt if no VFS)
 * @param vfs_mode VFS mode: "on-disk", "in-memory", or empty string if no VFS
 * @param vfs_config_blob Optional serialized VFS config (SVFG format, 366 bytes)
 * @return true if injection succeeded, false otherwise
 */
bool InjectSeaAndVfs(const std::string& executable_path,
                     const std::string& output_path,
                     const std::vector<uint8_t>& sea_blob,
                     const std::optional<std::string>& vfs_archive,
                     const std::string& vfs_mode,
                     const std::optional<std::vector<uint8_t>>& vfs_config_blob);

}  // namespace sea
}  // namespace node

#endif  // SRC_NODE_SEA_SMOL_H_
