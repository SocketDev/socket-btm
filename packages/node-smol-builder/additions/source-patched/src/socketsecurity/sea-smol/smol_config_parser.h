// ============================================================================
// smol_config_parser.h — Parse and serialize SEA/smol configuration
// ============================================================================
//
// WHAT THIS FILE DECLARES
// Functions for parsing the "smol" config block from sea-config.json and
// serializing config structs to binary format for embedding in executables.
//
// This file handles parsing and serialization ONLY. Injection logic lives
// in sea_inject.h — that separation keeps each file focused and keeps the
// patch on node_sea_bin.cc minimal.
// ============================================================================

#ifndef SRC_NODE_SEA_SMOL_CONFIG_PARSER_H_
#define SRC_NODE_SEA_SMOL_CONFIG_PARSER_H_

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "node_sea.h"
#include "simdjson.h"

namespace node {
namespace sea {

// Parse the "smol" configuration block from sea-config.json.
// Populates config.smol_update and config.smol_vfs in the SeaConfig.
bool ParseSmolConfig(
    simdjson::ondemand::object& smol_object,
    const std::string& config_path,
    SeaConfig& result);

// Serialize SmolUpdateConfig to binary (SMFG v2 format, 1192 bytes).
std::optional<std::vector<uint8_t>> SerializeSmolUpdateConfig(
    const SmolUpdateConfig& config);

}  // namespace sea
}  // namespace node

#endif  // SRC_NODE_SEA_SMOL_CONFIG_PARSER_H_
