/**
 * smol_config_parser.cc - Socket Security SEA/smol config parser
 *
 * Implementation of C++ wrapper functions that bridge Node.js SEA build system
 * with Socket Security's binject-core C API.
 */

#include "smol_config_parser.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

#ifdef _WIN32
#include <io.h>  // _unlink, _fileno, _get_osfhandle
#include <windows.h>  // FlushFileBuffers, HANDLE
#else
#include <unistd.h>  // unlink, fsync
#endif

// Socket Security C APIs.
extern "C" {
#include "socketsecurity/binject/smol_config.h"
#include "socketsecurity/binject/vfs_config.h"
#include "socketsecurity/binject/vfs_utils.h"
#include "socketsecurity/binject/binject.h"
#include "socketsecurity/build-infra/tmpdir_common.h"
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

std::optional<std::vector<uint8_t>> SerializeVfsConfig(
    const SmolVfsConfig& config) {
  per_process::Debug(DebugCategory::SEA, "Serializing VFS config\\n");

  // Initialize C struct.
  vfs_config_t c_config;
  vfs_config_init(&c_config);

  // Copy C++ strings to C struct fields.
  c_config.mode = config.mode.c_str();
  c_config.source = config.source.c_str();
  c_config.prefix = config.prefix.c_str();

  // Serialize to binary.
  uint8_t* binary = serialize_vfs_config(&c_config);
  if (!binary) {
    per_process::Debug(DebugCategory::SEA,
                       "Failed to serialize VFS config\\n");
    return std::nullopt;
  }

  // Copy to vector (serialize_vfs_config returns fixed VFS_CONFIG_SIZE-byte buffer).
  std::vector<uint8_t> result(binary, binary + VFS_CONFIG_SIZE);
  free(binary);

  per_process::Debug(DebugCategory::SEA,
                     "Serialized VFS config (%zu bytes)\\n",
                     result.size());
  return result;
}

std::optional<std::string> PrepareVfsArchive(
    const SmolVfsConfig& vfs_config,
    const std::string& sea_config_path) {
  per_process::Debug(DebugCategory::SEA, "Preparing VFS archive\\n");
  per_process::Debug(DebugCategory::SEA,
                     "  mode: %s\\n",
                     vfs_config.mode.c_str());
  per_process::Debug(DebugCategory::SEA,
                     "  source: %s\\n",
                     vfs_config.source.c_str());

  // Handle compat mode (no VFS embedding).
  if (vfs_config.mode == "compat") {
    per_process::Debug(DebugCategory::SEA,
                       "VFS compat mode - no archive needed\\n");
    return std::string("");  // Empty string signals compat mode.
  }

  // Resolve source path (may be relative to sea-config.json).
  char* resolved_path =
      resolve_relative_path(sea_config_path.c_str(), vfs_config.source.c_str());
  if (!resolved_path) {
    fprintf(stderr, "Error: Failed to resolve VFS source path: %s\\n",
            vfs_config.source.c_str());
    return std::nullopt;
  }

  std::string source_path(resolved_path);
  free(resolved_path);

  per_process::Debug(DebugCategory::SEA,
                     "  resolved path: %s\\n",
                     source_path.c_str());

  // Detect source type.
  vfs_source_type_t source_type = detect_vfs_source_type(source_path.c_str());

  per_process::Debug(DebugCategory::SEA, "  source type: %d\\n", source_type);

  if (source_type == VFS_SOURCE_NOT_FOUND) {
    fprintf(stderr, "Warning: VFS source not found: %s\\n",
            source_path.c_str());
    return std::nullopt;
  }

  if (source_type == VFS_SOURCE_ERROR) {
    fprintf(stderr, "Error: Invalid VFS source type: %s\\n",
            source_path.c_str());
    return std::nullopt;
  }

  // Handle different source types.
  char* archive_path = nullptr;

  if (source_type == VFS_SOURCE_TAR_GZ) {
    // Already a .tar.gz - use as-is.
    per_process::Debug(DebugCategory::SEA,
                       "Source is .tar.gz, using as-is\\n");
    archive_path = strdup(source_path.c_str());
  } else if (source_type == VFS_SOURCE_TAR) {
    // .tar file - needs compression.
    per_process::Debug(DebugCategory::SEA, "Compressing .tar to .tar.gz\\n");
    archive_path = compress_tar_archive(source_path.c_str());
  } else if (source_type == VFS_SOURCE_DIR) {
    // Directory - needs archiving + compression.
    per_process::Debug(DebugCategory::SEA,
                       "Creating .tar.gz from directory\\n");
    archive_path = create_vfs_archive_from_dir(source_path.c_str());
  }

  if (!archive_path) {
    fprintf(stderr, "Error: Failed to prepare VFS archive from %s\\n",
            source_path.c_str());
    return std::nullopt;
  }

  // Get archive size for logging.
  long archive_size = get_file_size(archive_path);
  per_process::Debug(DebugCategory::SEA,
                     "VFS archive prepared: %s (%ld bytes)\\n",
                     archive_path,
                     archive_size);

  std::string result(archive_path);
  free(archive_path);

  return result;
}

bool InjectSeaAndVfs(const std::string& executable_path,
                     const std::string& output_path,
                     const std::vector<uint8_t>& sea_blob,
                     const std::optional<std::string>& vfs_archive,
                     const std::string& vfs_mode,
                     const std::optional<std::vector<uint8_t>>& vfs_config_blob) {
  per_process::Debug(DebugCategory::SEA,
                     "Injecting SEA blob + VFS into executable\\n");
  per_process::Debug(DebugCategory::SEA,
                     "  executable: %s\\n",
                     executable_path.c_str());
  per_process::Debug(DebugCategory::SEA,
                     "  output: %s\\n",
                     output_path.c_str());
  per_process::Debug(DebugCategory::SEA,
                     "  SEA blob: %zu bytes\\n",
                     sea_blob.size());

  // Write SEA blob to temporary file (binject_batch expects file paths).
  // Use get_tmpdir() to respect TMPDIR/TMP/TEMP environment variables.
  const char* tmpdir = get_tmpdir(NULL);
  char sea_tmp[512];
  snprintf(sea_tmp, sizeof(sea_tmp), "%s/sea_blob.bin", tmpdir);
  FILE* f = fopen(sea_tmp, "wb");
  if (!f) {
    int saved_errno = errno;
    fprintf(stderr, "Error: Failed to create temporary SEA blob file: %s (errno: %d)\\n",
            sea_tmp, saved_errno);
    return false;
  }

  size_t written = fwrite(sea_blob.data(), 1, sea_blob.size(), f);
  if (written != sea_blob.size()) {
    int saved_errno = errno;
    fprintf(stderr, "Error: Failed to write SEA blob: wrote %zu of %zu bytes (errno: %d)\\n",
            written, sea_blob.size(), saved_errno);
    fclose(f);
    unlink(sea_tmp);  // Remove incomplete file
    return false;
  }

  // Sync data to disk before closing (prevents data loss on power failure)
#ifndef _WIN32
  if (fsync(fileno(f)) != 0) {
    int saved_errno = errno;
    fprintf(stderr, "Error: Failed to sync SEA blob to disk: %s (errno: %d)\\n",
            strerror(saved_errno), saved_errno);
    fclose(f);
    unlink(sea_tmp);
    return false;
  }
#else
  // Windows: Flush file buffers to disk
  if (!FlushFileBuffers((HANDLE)_get_osfhandle(_fileno(f)))) {
    fprintf(stderr, "Error: Failed to flush SEA blob to disk (FlushFileBuffers failed)\\n");
    fclose(f);
    unlink(sea_tmp);
    return false;
  }
#endif

  // Check fclose() - critical for detecting APFS delayed allocation failures
  if (fclose(f) != 0) {
    int saved_errno = errno;
    fprintf(stderr, "Error: Failed to close SEA blob file (data may not be flushed): %s (errno: %d)\\n",
            strerror(saved_errno), saved_errno);
    unlink(sea_tmp);  // Remove potentially incomplete file
    return false;
  }

  per_process::Debug(DebugCategory::SEA,
                     "  wrote SEA blob to %s\\n",
                     sea_tmp);

  // Prepare VFS parameters.
  const char* vfs_tmp = nullptr;
  int vfs_in_memory = 0;

  if (vfs_archive.has_value()) {
    if (vfs_archive.value().empty()) {
      // Compat mode - no VFS injection.
      per_process::Debug(DebugCategory::SEA, "  VFS: compat mode (no VFS)\\n");
      vfs_tmp = nullptr;
    } else {
      // VFS archive provided.
      vfs_tmp = vfs_archive.value().c_str();
      per_process::Debug(DebugCategory::SEA, "  VFS: %s\\n", vfs_tmp);

      // Determine vfs_in_memory from vfs_mode parameter.
      if (vfs_mode == "in-memory") {
        vfs_in_memory = 1;
        per_process::Debug(DebugCategory::SEA, "  VFS mode: in-memory\\n");
      } else if (vfs_mode == "on-disk") {
        vfs_in_memory = 0;
        per_process::Debug(DebugCategory::SEA, "  VFS mode: on-disk\\n");
      } else {
        // Default to on-disk for empty/unknown modes
        vfs_in_memory = 0;
        per_process::Debug(DebugCategory::SEA, "  VFS mode: on-disk (default)\\n");
      }
    }
  } else {
    per_process::Debug(DebugCategory::SEA, "  VFS: none\\n");
  }

  // Call binject_batch() C API.
  // Pass VFS config binary data if available.
  const uint8_t* vfs_config_data = vfs_config_blob.has_value()
                                      ? vfs_config_blob->data()
                                      : nullptr;

  int binject_result = binject_batch(executable_path.c_str(),
                                      output_path.c_str(),
                                      sea_tmp,
                                      vfs_tmp,
                                      vfs_in_memory,
                                      0,  // skip_repack.
                                      vfs_config_data);

  // Cleanup temporary files.
  unlink(sea_tmp);

  if (binject_result != BINJECT_OK) {
    fprintf(stderr,
            "Error: binject_batch() failed with code %d\\n",
            binject_result);
    return false;
  }

  per_process::Debug(DebugCategory::SEA,
                     "Successfully injected SEA + VFS\\n");
  return true;
}

}  // namespace sea
}  // namespace node
