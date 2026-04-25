// ============================================================================
// sea_inject.cc — VFS archive preparation and binary injection
// ============================================================================
//
// WHAT THIS FILE DOES
// Implements three stages of the SEA injection pipeline:
//   1. PrepareVfsArchive: creates a .tar.gz from a directory, .tar, or .tar.gz
//   2. InjectSeaAndVfs: writes SEA blob + VFS to a temp file, calls binject
//   3. PrepareAndInjectSea: orchestrates 1+2 from a single SeaConfig
//
// WHY IT EXISTS
// The alternative is putting this logic inside a patch on node_sea_bin.cc,
// which makes the patch large and fragile across Node.js version updates.
// By keeping injection logic here in additions/, the patch stays minimal:
// just one #include and one function call.
//
// KEY CONCEPTS FOR JS DEVELOPERS
// - binject_batch(): A C function from our binject library that writes data
//   segments into compiled executables (ELF on Linux, Mach-O on macOS, PE
//   on Windows). Think of it as "appending named data to a binary file."
// - POSIX_UNLINK: Cross-platform file deletion (unlink on Unix, _unlink on
//   Windows). Used to clean up temp files after injection.
// - get_tmpdir(): Returns the platform temp directory (respects TMPDIR env).
// ============================================================================

#include "socketsecurity/sea-smol/sea_inject.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "socketsecurity/build-infra/file_io_common.h"
#include "socketsecurity/build-infra/posix_compat.h"

#ifdef _WIN32
#include <io.h>
#include <windows.h>
#else
#include <unistd.h>
#endif

extern "C" {
#include "socketsecurity/binject/vfs_config.h"
#include "socketsecurity/binject/vfs_utils.h"
#include "socketsecurity/binject/binject.h"
#include "socketsecurity/build-infra/tmpdir_common.h"
}

#include "debug_utils-inl.h"
#include "util-inl.h"

namespace node {
namespace sea {

std::optional<std::string> PrepareVfsArchive(
    const SmolVfsConfig& vfs_config,
    const std::string& sea_config_path) {
  per_process::Debug(DebugCategory::SEA, "Preparing VFS archive\n");
  per_process::Debug(DebugCategory::SEA,
                     "  mode: %s\n",
                     vfs_config.mode.c_str());
  per_process::Debug(DebugCategory::SEA,
                     "  source: %s\n",
                     vfs_config.source.c_str());

  // Handle compat mode (no VFS embedding).
  if (vfs_config.mode == "compat") {
    per_process::Debug(DebugCategory::SEA,
                       "VFS compat mode - no archive needed\n");
    return std::string("");
  }

  // Resolve source path (may be relative to sea-config.json).
  char* resolved_path =
      resolve_relative_path(sea_config_path.c_str(), vfs_config.source.c_str());
  if (!resolved_path) {
    fprintf(stderr, "Error: Failed to resolve VFS source path: %s\n",
            vfs_config.source.c_str());
    return std::nullopt;
  }

  std::string source_path(resolved_path);
  free(resolved_path);

  per_process::Debug(DebugCategory::SEA,
                     "  resolved path: %s\n",
                     source_path.c_str());

  // Detect source type.
  vfs_source_type_t source_type = detect_vfs_source_type(source_path.c_str());

  per_process::Debug(DebugCategory::SEA, "  source type: %d\n", source_type);

  if (source_type == VFS_SOURCE_NOT_FOUND) {
    fprintf(stderr, "Warning: VFS source not found: %s\n",
            source_path.c_str());
    return std::nullopt;
  }

  if (source_type == VFS_SOURCE_ERROR) {
    fprintf(stderr, "Error: Invalid VFS source type: %s\n",
            source_path.c_str());
    return std::nullopt;
  }

  // Handle different source types.
  char* archive_path = nullptr;

  if (source_type == VFS_SOURCE_TAR_GZ) {
    // Already a .tar.gz — use as-is.
    per_process::Debug(DebugCategory::SEA,
                       "Source is .tar.gz, using as-is\n");
    archive_path = strdup(source_path.c_str());
  } else if (source_type == VFS_SOURCE_TAR) {
    // .tar file — needs compression.
    per_process::Debug(DebugCategory::SEA, "Compressing .tar to .tar.gz\n");
    archive_path = compress_tar_archive(source_path.c_str());
  } else if (source_type == VFS_SOURCE_DIR) {
    // Directory — needs archiving + compression.
    per_process::Debug(DebugCategory::SEA,
                       "Creating .tar.gz from directory\n");
    archive_path = create_vfs_archive_from_dir(source_path.c_str());
  }

  if (!archive_path) {
    fprintf(stderr, "Error: Failed to prepare VFS archive from %s\n",
            source_path.c_str());
    return std::nullopt;
  }

  long archive_size = get_file_size(archive_path);
  per_process::Debug(DebugCategory::SEA,
                     "VFS archive prepared: %s (%ld bytes)\n",
                     archive_path,
                     archive_size);

  std::string result(archive_path);
  free(archive_path);

  return result;
}

std::optional<std::vector<uint8_t>> SerializeVfsConfig(
    const SmolVfsConfig& config) {
  // Populate C config struct from C++ struct.
  vfs_config_t vfs_cfg;
  vfs_config_init(&vfs_cfg);
  vfs_cfg.mode = config.mode.c_str();
  vfs_cfg.prefix = config.prefix.c_str();

  // Serialize to SVFG binary format.
  uint8_t* data = serialize_vfs_config(&vfs_cfg);
  if (data == nullptr) {
    return std::nullopt;
  }

  std::vector<uint8_t> result(data, data + VFS_CFG_SIZE);
  free(data);

  per_process::Debug(DebugCategory::SEA,
                     "Serialized VFS config (%zu bytes)\n",
                     result.size());
  return result;
}

bool InjectSeaAndVfs(const std::string& executable_path,
                     const std::string& output_path,
                     const std::vector<uint8_t>& sea_blob,
                     const std::optional<std::string>& vfs_archive,
                     const std::string& vfs_mode,
                     const std::optional<std::vector<uint8_t>>& vfs_config_blob) {
  per_process::Debug(DebugCategory::SEA,
                     "Injecting SEA blob + VFS into executable\n");
  per_process::Debug(DebugCategory::SEA,
                     "  executable: %s\n",
                     executable_path.c_str());
  per_process::Debug(DebugCategory::SEA,
                     "  output: %s\n",
                     output_path.c_str());
  per_process::Debug(DebugCategory::SEA,
                     "  SEA blob: %zu bytes\n",
                     sea_blob.size());

  // Write SEA blob to a UNIQUE temporary file (binject_batch expects
  // file paths). Previously this used a hardcoded "/tmp/sea_blob.bin"
  // name, which is a classic TOCTOU / symlink-follow trap: a local
  // attacker on a shared CI runner could pre-create that path as a
  // symlink to an arbitrary writable file, and our fopen("wb") would
  // follow the symlink and overwrite it with the SEA blob's bytes.
  // Two concurrent builds would also clobber each other. mkstemp
  // (Unix) and _sopen_s+_O_EXCL (Windows, via mkstemp_portable in
  // build-infra/file_io_common.h) create the file atomically with
  // O_EXCL, failing if the path already exists and never following
  // symlinks.
  const char* tmpdir = get_tmpdir(NULL);
  char sea_tmp[512];
  snprintf(sea_tmp, sizeof(sea_tmp), "%s/sea_blob.XXXXXX", tmpdir);
  int sea_fd = mkstemp(sea_tmp);
  if (sea_fd < 0) {
    int saved_errno = errno;
    fprintf(stderr, "Error: Failed to create temporary SEA blob file: %s (errno: %d)\n",
            sea_tmp, saved_errno);
    return false;
  }
  FILE* f = fdopen(sea_fd, "wb");
  if (!f) {
    int saved_errno = errno;
    fprintf(stderr, "Error: Failed to open temporary SEA blob file handle: %s (errno: %d)\n",
            sea_tmp, saved_errno);
    close(sea_fd);
    POSIX_UNLINK(sea_tmp);
    return false;
  }

  size_t written = fwrite(sea_blob.data(), 1, sea_blob.size(), f);
  if (written != sea_blob.size()) {
    int saved_errno = errno;
    fprintf(stderr, "Error: Failed to write SEA blob: wrote %zu of %zu bytes (errno: %d)\n",
            written, sea_blob.size(), saved_errno);
    fclose(f);
    POSIX_UNLINK(sea_tmp);
    return false;
  }

  if (fclose(f) != 0) {
    int saved_errno = errno;
    fprintf(stderr, "Error: Failed to close SEA blob file: %s (errno: %d)\n",
            strerror(saved_errno), saved_errno);
    POSIX_UNLINK(sea_tmp);
    return false;
  }

  per_process::Debug(DebugCategory::SEA,
                     "  wrote SEA blob to %s\n",
                     sea_tmp);

  // Prepare VFS parameters.
  const char* vfs_tmp = nullptr;
  int vfs_in_memory = 0;

  if (vfs_archive.has_value()) {
    if (vfs_archive.value().empty()) {
      per_process::Debug(DebugCategory::SEA, "  VFS: compat mode (no VFS)\n");
      vfs_tmp = nullptr;
    } else {
      vfs_tmp = vfs_archive.value().c_str();
      per_process::Debug(DebugCategory::SEA, "  VFS: %s\n", vfs_tmp);

      if (vfs_mode == "in-memory") {
        vfs_in_memory = 1;
        per_process::Debug(DebugCategory::SEA, "  VFS mode: in-memory\n");
      } else if (vfs_mode == "on-disk") {
        vfs_in_memory = 0;
        per_process::Debug(DebugCategory::SEA, "  VFS mode: on-disk\n");
      } else {
        vfs_in_memory = 0;
        per_process::Debug(DebugCategory::SEA, "  VFS mode: on-disk (default)\n");
      }
    }
  } else {
    per_process::Debug(DebugCategory::SEA, "  VFS: none\n");
  }

  // Call binject_batch() C API.
  const uint8_t* vfs_config_data = vfs_config_blob.has_value()
                                      ? vfs_config_blob->data()
                                      : nullptr;

  int binject_result = binject_batch(executable_path.c_str(),
                                      output_path.c_str(),
                                      sea_tmp,
                                      vfs_tmp,
                                      vfs_in_memory,
                                      0,
                                      vfs_config_data);

  // Cleanup temporary files.
  POSIX_UNLINK(sea_tmp);

  if (binject_result != BINJECT_OK) {
    fprintf(stderr,
            "Error: binject_batch() failed with code %d\n",
            binject_result);
    return false;
  }

  per_process::Debug(DebugCategory::SEA,
                     "Successfully injected SEA + VFS\n");
  return true;
}

bool PrepareAndInjectSea(const SeaConfig& config,
                         const std::string& sea_config_path,
                         const std::vector<uint8_t>& sea_blob) {
  std::optional<std::string> vfs_archive;
  std::string vfs_mode;
  std::optional<std::vector<uint8_t>> vfs_config_blob;

  if (config.smol_vfs.has_value()) {
    const SmolVfsConfig& vfs = config.smol_vfs.value();
    vfs_mode = vfs.mode;

    std::optional<std::string> archive_path =
        PrepareVfsArchive(vfs, sea_config_path);
    if (!archive_path.has_value()) {
      FPrintF(stderr, "Error: Failed to prepare VFS archive\n");
      return false;
    }
    if (!archive_path.value().empty()) {
      vfs_archive = archive_path.value();
    }

    vfs_config_blob = SerializeVfsConfig(vfs);
    if (!vfs_config_blob.has_value()) {
      FPrintF(stderr, "Error: Failed to serialize VFS config\n");
      return false;
    }
  }

  return InjectSeaAndVfs(config.executable_path,
                         config.output_path,
                         sea_blob,
                         vfs_archive,
                         vfs_mode,
                         vfs_config_blob);
}

}  // namespace sea
}  // namespace node
