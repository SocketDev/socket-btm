// ============================================================================
// smol_config_parser.cc — Parse and serialize SEA/smol configuration
// ============================================================================
//
// WHAT THIS FILE DOES
// Parses the "smol" block from sea-config.json (VFS settings, update config)
// and serializes SmolUpdateConfig to binary format for embedding.
//
// Injection logic (PrepareVfsArchive, InjectSeaAndVfs, PrepareAndInjectSea)
// lives in sea_inject.cc — this file only handles parsing and serialization.
// ============================================================================

#include "smol_config_parser.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

// Socket Security C APIs (only smol_config needed for serialization).
extern "C" {
#include "socketsecurity/binject/smol_config.h"
}

// Node.js internal APIs.
#include "debug_utils-inl.h"
#include "util-inl.h"

namespace node {
namespace sea {

bool ParseSmolConfig(
    simdjson::ondemand::object& smol_object,
    const std::string& config_path,
    SeaConfig& result) {
  per_process::Debug(DebugCategory::SEA, "Parsing smol config\n");

  // Create a SmolUpdateConfig to populate
  SmolUpdateConfig config;
  config.binname = "";
  config.command = "";
  config.url = "";
  config.tag = "";
  config.skip_env = "";
  config.fake_argv_env = "";
  config.prompt = false;
  config.prompt_default = false;
  config.interval = 0;
  config.notify_interval = 0;

  // Parse each field from the smol object
  for (auto field : smol_object) {
    std::string_view key;
    if (field.unescaped_key().get(key)) {
      fprintf(stderr, "Error: Failed to get key from smol config\n");
      return false;
    }

    if (key == "binname") {
      std::string_view value;
      if (field.value().get(value)) {
        fprintf(stderr, "Error: Failed to parse 'binname' in smol config\n");
        return false;
      }
      config.binname = std::string(value);
    } else if (key == "command") {
      std::string_view value;
      if (field.value().get(value)) {
        fprintf(stderr, "Error: Failed to parse 'command' in smol config\n");
        return false;
      }
      config.command = std::string(value);
    } else if (key == "url") {
      std::string_view value;
      if (field.value().get(value)) {
        fprintf(stderr, "Error: Failed to parse 'url' in smol config\n");
        return false;
      }
      config.url = std::string(value);
    } else if (key == "tag") {
      std::string_view value;
      if (field.value().get(value)) {
        fprintf(stderr, "Error: Failed to parse 'tag' in smol config\n");
        return false;
      }
      config.tag = std::string(value);
    } else if (key == "skipEnv") {
      std::string_view value;
      if (field.value().get(value)) {
        fprintf(stderr, "Error: Failed to parse 'skipEnv' in smol config\n");
        return false;
      }
      config.skip_env = std::string(value);
    } else if (key == "fakeArgvEnv") {
      std::string_view value;
      if (field.value().get(value)) {
        fprintf(stderr, "Error: Failed to parse 'fakeArgvEnv' in smol config\n");
        return false;
      }
      config.fake_argv_env = std::string(value);
    } else if (key == "prompt") {
      bool value;
      if (field.value().get(value)) {
        fprintf(stderr, "Error: Failed to parse 'prompt' in smol config\n");
        return false;
      }
      config.prompt = value;
    } else if (key == "promptDefault") {
      bool value;
      if (field.value().get(value)) {
        fprintf(stderr, "Error: Failed to parse 'promptDefault' in smol config\n");
        return false;
      }
      config.prompt_default = value;
    } else if (key == "interval") {
      int64_t value;
      if (field.value().get(value)) {
        fprintf(stderr, "Error: Failed to parse 'interval' in smol config\n");
        return false;
      }
      config.interval = static_cast<int>(value);
    } else if (key == "notifyInterval") {
      int64_t value;
      if (field.value().get(value)) {
        fprintf(stderr, "Error: Failed to parse 'notifyInterval' in smol config\n");
        return false;
      }
      config.notify_interval = static_cast<int>(value);
    } else if (key == "vfs") {
      simdjson::ondemand::object vfs_obj;
      if (field.value().get(vfs_obj)) {
        fprintf(stderr, "Error: Failed to parse 'vfs' object in smol config\n");
        return false;
      }

      // Create a SmolVfsConfig to populate
      SmolVfsConfig vfs_config;
      vfs_config.mode = "";
      vfs_config.source = "";
      vfs_config.prefix = "";

      // Parse VFS configuration
      for (auto vfs_field : vfs_obj) {
        std::string_view vfs_key;
        if (vfs_field.unescaped_key().get(vfs_key)) {
          fprintf(stderr, "Error: Failed to get key from vfs config\n");
          return false;
        }

        if (vfs_key == "mode") {
          std::string_view value;
          if (vfs_field.value().get(value)) {
            fprintf(stderr, "Error: Failed to parse 'mode' in vfs config\n");
            return false;
          }
          vfs_config.mode = std::string(value);
        } else if (vfs_key == "source") {
          std::string_view value;
          if (vfs_field.value().get(value)) {
            fprintf(stderr, "Error: Failed to parse 'source' in vfs config\n");
            return false;
          }
          vfs_config.source = std::string(value);
        } else if (vfs_key == "prefix") {
          std::string_view value;
          if (vfs_field.value().get(value)) {
            fprintf(stderr, "Error: Failed to parse 'prefix' in vfs config\n");
            return false;
          }
          vfs_config.prefix = std::string(value);
        }
      }

      // Assign the populated VFS config to the optional
      result.smol_vfs = vfs_config;
    }
  }

  // Assign the populated config to the optional
  result.smol_update = config;

  per_process::Debug(DebugCategory::SEA, "Successfully parsed smol config\n");
  per_process::Debug(DebugCategory::SEA, "  binname: %s\n",
                     config.binname.c_str());
  per_process::Debug(DebugCategory::SEA, "  url: %s\n",
                     config.url.c_str());
  if (result.smol_vfs.has_value()) {
    per_process::Debug(DebugCategory::SEA, "  vfs mode: %s\n",
                       result.smol_vfs->mode.c_str());
  }

  return true;
}

std::optional<std::vector<uint8_t>> SerializeSmolUpdateConfig(
    const SmolUpdateConfig& config) {
  per_process::Debug(DebugCategory::SEA, "Serializing smol update config\\n");

  // Initialize C struct.
  smol_update_config_t c_config;
  smol_config_init(&c_config);

  // Copy C++ strings to C struct fields.
  c_config.binname = config.binname.c_str();
  c_config.command = config.command.c_str();
  c_config.url = config.url.c_str();
  c_config.tag = config.tag.c_str();
  c_config.skip_env = config.skip_env.c_str();
  c_config.fake_argv_env = config.fake_argv_env.c_str();
  c_config.prompt = config.prompt;
  c_config.prompt_default = config.prompt_default;
  c_config.interval = config.interval;
  c_config.notify_interval = config.notify_interval;

  // Serialize to binary.
  uint8_t* binary = serialize_smol_config(&c_config);
  if (!binary) {
    per_process::Debug(DebugCategory::SEA,
                       "Failed to serialize smol config\\n");
    return std::nullopt;
  }

  // Copy to vector (serialize_smol_config returns fixed 1176-byte buffer).
  std::vector<uint8_t> result(binary, binary + 1176);
  free(binary);

  per_process::Debug(DebugCategory::SEA,
                     "Serialized smol config (%zu bytes)\\n",
                     result.size());
  return result;
}

// SerializeVfsConfig, PrepareVfsArchive, InjectSeaAndVfs, and
// PrepareAndInjectSea have been moved to sea_inject.cc for better
// separation of concerns (parsing vs injection).

}  // namespace sea
}  // namespace node
