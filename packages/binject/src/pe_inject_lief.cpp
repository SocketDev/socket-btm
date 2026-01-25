/**
 * PE binary injection using LIEF
 *
 * Uses LIEF C++ library to inject resources into PE binaries.
 * Implements resource-based injection (RT_RCDATA in .rsrc section) for
 * Windows/Node.js SEA compatibility, matching postject behavior.
 *
 * CRITICAL: This implementation uses PE resources, NOT sections!
 * - Old: Inject into .node_sea_blob section
 * - New: Inject into .rsrc section as RT_RCDATA resource
 * - Reason: Node.js uses FindResource/LoadResource APIs on Windows
 */

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <vector>

// Suppress deprecation warning for wstring_convert (deprecated in C++17)
// We use this for PE resource name conversion (UTF-16) and there's no
// standard replacement yet. When C++20/23 alternatives are available, migrate.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
#include <codecvt>
#include <locale>
#pragma GCC diagnostic pop
#include <limits.h>
#include <sys/stat.h>

// Platform-specific headers.
#ifdef _WIN32
#include <windows.h>  // for FlushFileBuffers(), HANDLE
#include <process.h>
#include <io.h>
#ifndef PATH_MAX
#define PATH_MAX 260
#endif
#else
#include <unistd.h>
#endif

#include <LIEF/LIEF.hpp>

extern "C" {
#include "segment_names.h"
#include "binject.h"
#include "file_utils.h"
}

// Shared DRY infrastructure (must come after binject.h for error codes)
#include "binject_file_utils.hpp"
#include "binject_lief_traits.hpp"
#include "binject_sea_fuse.hpp"
#include "binject_section_ops.hpp"

/**
 * Helper: Convert resource name to uppercase (Windows convention)
 *
 * Windows resource APIs expect uppercase names for string-based resources.
 * This matches the behavior of postject and Node.js SEA.
 */
static std::string uppercase_resource_name(const std::string& name) {
    std::string upper = name;
    std::transform(upper.begin(), upper.end(), upper.begin(), ::toupper);
    return upper;
}

/**
 * Helper: Inject RT_RCDATA resource into PE binary
 *
 * Implements the three-level PE resource tree:
 * 1. Type Level: RT_RCDATA (type 10)
 * 2. Name Level: Resource name (e.g., "NODE_SEA_BLOB", "SMOL_VFS_BLOB")
 * 3. Language Level: Resource data
 *
 * Based on postject implementation (src/postject.cpp:inject_into_pe).
 *
 * @param binary LIEF PE binary to modify
 * @param resource_name Name of the resource (will be uppercased)
 * @param data Resource data to inject
 * @param size Size of resource data in bytes
 * @param overwrite If true, remove existing resource before adding
 * @return BINJECT_OK on success, error code otherwise
 */
static int inject_pe_resource(LIEF::PE::Binary* binary,
                               const char* resource_name,
                               const uint8_t* data,
                               size_t size,
                               bool overwrite) {
    if (!binary) {
        fprintf(stderr, "Error: Binary is NULL\n");
        return BINJECT_ERROR_INVALID_ARGS;
    }

    // Uppercase resource name for Windows compatibility
    std::string upper_name = uppercase_resource_name(resource_name);
    printf("Injecting PE resource: %s (uppercased: %s) with %zu bytes...\n",
           resource_name, upper_name.c_str(), size);

    // Check if binary has resources section
    if (!binary->has_resources()) {
        fprintf(stderr, "Error: Binary has no resources section\n");
        fprintf(stderr, "  Creating resource tree from scratch is not yet supported\n");
        fprintf(stderr, "  Workaround: Use a PE with existing resources, or add empty .rsrc section\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    LIEF::PE::ResourceNode* resources = binary->resources();
    LIEF::PE::ResourceNode* rcdata_node = nullptr;
    LIEF::PE::ResourceNode* id_node = nullptr;

    // First level => Type (ResourceDirectory node)
    // Look for RT_RCDATA (type 10) in the resource tree
    // Note: LIEF 0.17 moved RESOURCE_TYPES to ResourcesManager::TYPE
    // Use LIEF_RT_RCDATA to avoid conflict with Windows RT_RCDATA macro
    const uint32_t LIEF_RT_RCDATA = static_cast<uint32_t>(LIEF::PE::ResourcesManager::TYPE::RCDATA);

    for (LIEF::PE::ResourceNode& node : resources->childs()) {
        if (node.id() == LIEF_RT_RCDATA) {
            rcdata_node = &node;
            printf("  Found existing RT_RCDATA node\n");
            break;
        }
    }

    if (!rcdata_node) {
        LIEF::PE::ResourceDirectory new_rcdata_node;
        new_rcdata_node.id(LIEF_RT_RCDATA);
        rcdata_node = &resources->add_child(new_rcdata_node);
        printf("  Created new RT_RCDATA node\n");
    }

    // Second level => ID (ResourceDirectory node)
    // Convert resource name to UTF-16 for Windows API compatibility
    std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t> converter;
    std::u16string u16_name = converter.from_bytes(upper_name);

    for (LIEF::PE::ResourceNode& node : rcdata_node->childs()) {
        if (node.name() == u16_name) {
            id_node = &node;
            printf("  Found existing resource name node\n");
            break;
        }
    }

    if (!id_node) {
        LIEF::PE::ResourceDirectory new_id_node;
        new_id_node.name(upper_name);
        // CRITICAL: Must set this ID for LIEF to save the name
        // This is undocumented but required by LIEF (see postject comment)
        new_id_node.id(0x80000000);
        id_node = &rcdata_node->add_child(new_id_node);
        printf("  Created new resource name node\n");
    }

    // Third level => Lang (ResourceData node)
    // Check if resource data already exists
    for (LIEF::PE::ResourceNode& node : id_node->childs()) {
        if (!overwrite) {
            fprintf(stderr, "Error: Resource already exists: %s\n", upper_name.c_str());
            return BINJECT_ERROR_SECTION_EXISTS;
        }

        printf("  Removing existing resource data (overwrite mode)\n");
        id_node->delete_child(node);
        break;  // Only delete first child
    }

    // Add resource data
    LIEF::PE::ResourceData lang_node;
    if (size > 0 && data) {
        std::vector<uint8_t> content_vec(data, data + size);
        lang_node.content(std::move(content_vec));
    }
    id_node->add_child(lang_node);
    printf("  Added resource data (%zu bytes)\n", size);

    return BINJECT_OK;
}

/**
 * Helper: Rebuild PE binary with resources
 *
 * LIEF 0.17 API changes:
 * - Builder now requires config_t parameter with per-feature flags
 * - No more individual build_* methods with boolean parameters
 * - build() method handles everything based on config
 *
 * Resource rebuild process (postject-style):
 * 1. Remove old .rsrc section
 * 2. Build with resources enabled (creates new .rsrc)
 * 3. Return rebuilt binary
 *
 * Note: In LIEF 0.17, the resource section is properly named .rsrc by default,
 * no need for the old .l2 rename workaround from older LIEF versions.
 *
 * @param binary LIEF PE binary with modified resources
 * @return Vector of bytes containing rebuilt binary, or empty on error
 */
static std::vector<uint8_t> rebuild_pe_with_resources(LIEF::PE::Binary* binary) {
    printf("Rebuilding PE binary with resources (LIEF 0.17 API)...\n");

    // Remove old .rsrc section (will be replaced)
    if (binary->get_section(".rsrc")) {
        printf("  Removing old .rsrc section\n");
        binary->remove_section(".rsrc", true);
    }

    // Configure builder: Enable only resources, disable everything else
    printf("  Configuring builder...\n");
    LIEF::PE::Builder::config_t config;
    config.resources = true;      // Enable resource building
    config.imports = false;       // Don't modify imports
    config.exports = false;       // Don't modify exports
    config.relocations = false;   // Don't modify relocations
    config.load_configuration = false;  // Don't modify load config
    config.tls = false;           // Don't modify TLS
    config.overlay = true;        // Preserve overlay data
    config.dos_stub = true;       // Preserve DOS stub
    config.debug = false;         // Don't modify debug info
    config.rsrc_section = ".rsrc"; // Use standard .rsrc name

    // Build with resources
    printf("  Building PE binary with resources...\n");
    LIEF::PE::Builder builder(*binary, config);

    auto result = builder.build();
    if (!result) {
        fprintf(stderr, "Error: LIEF builder failed\n");
        // Note: LIEF 0.17 error handling - result is ok_error_t
        // Cannot access detailed error message in current API
        return {};
    }

    const std::vector<uint8_t>& output = builder.get_build();
    if (output.empty()) {
        fprintf(stderr, "Error: LIEF builder produced empty output\n");
        return {};
    }

    printf("  Successfully rebuilt PE binary (%zu bytes)\n", output.size());
    return output;
}

/**
 * Inject resource into PE binary using LIEF (resource-based, NOT section-based).
 *
 * CRITICAL CHANGE: This function now injects into PE resources (.rsrc section)
 * as RT_RCDATA, NOT into custom sections like .node_sea_blob.
 *
 * Implementation pattern:
 * 1. Validate arguments (allow NULL data with size 0 for VFS compat mode).
 * 2. Parse binary with LIEF parser.
 * 3. Inject resource into PE resource tree (RT_RCDATA type).
 * 4. Rebuild binary with resources (LIEF quirk: creates .l2, rename to .rsrc).
 * 5. Write modified binary (atomic rename workflow).
 *
 * Why resources instead of sections?
 * - Node.js uses FindResource/LoadResource Windows APIs
 * - Postject uses RT_RCDATA resources for Windows compatibility
 * - This is REQUIRED for Node.js SEA to work on Windows
 *
 * @param executable Path to the PE binary.
 * @param resource_name Resource name (e.g., "NODE_SEA_BLOB" or "SMOL_VFS_BLOB").
 *                      Will be uppercased for Windows API compatibility.
 * @param data Resource data to inject.
 * @param size Size of resource data in bytes.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_pe_lief(const char* executable,
                               const char* resource_name,
                               const uint8_t* data,
                               size_t size) {
  // Step 1: Validate arguments.
  if (!executable || !resource_name) {
    fprintf(stderr, "Error: Invalid arguments (NULL parameter)\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

  // Allow NULL data with size 0 for VFS compatibility mode (0-byte resource).
  if (!data && size != 0) {
    fprintf(stderr, "Error: Invalid arguments (data is NULL but size is non-zero)\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

  try {
    printf("Using LIEF for PE resource injection (Windows/Node.js SEA compatible)...\n");

    // Step 2: Parse binary.
    std::unique_ptr<LIEF::PE::Binary> binary =
        LIEF::PE::Parser::parse(executable);

    if (!binary) {
      fprintf(stderr, "Error: Failed to parse PE binary: %s\n", executable);
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Step 3: Inject resource into PE resource tree (auto-overwrite).
    int result = inject_pe_resource(binary.get(), resource_name, data, size, true);
    if (result != BINJECT_OK) {
      return result;
    }

    // Step 4: Rebuild binary with resources.
    std::vector<uint8_t> output = rebuild_pe_with_resources(binary.get());
    if (output.empty()) {
      fprintf(stderr, "Error: Failed to rebuild PE binary with resources\n");
      return BINJECT_ERROR;
    }

    // Step 5: Write modified binary (atomic rename workflow).
    char tmpfile[PATH_MAX];
    binject::create_temp_path(executable, tmpfile, sizeof(tmpfile));

    // Create parent directories if needed.
    if (create_parent_directories(tmpfile) != 0) {
      fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", tmpfile);
      return BINJECT_ERROR;
    }

    // Write output to temp file
    printf("Writing modified binary to temp file...\n");
    FILE* fp = fopen(tmpfile, "wb");
    if (!fp) {
      fprintf(stderr, "Error: Failed to open temp file for writing: %s\n", tmpfile);
      return BINJECT_ERROR_WRITE_FAILED;
    }

    size_t written = fwrite(output.data(), 1, output.size(), fp);

    /* Ensure binary is fully written to disk before rename to prevent race condition */
#ifndef _WIN32
    int fd = fileno(fp);
    if (fsync(fd) != 0) {
        fprintf(stderr, "Warning: fsync failed: %s\n", strerror(errno));
    }
#else
    /* Windows: Flush file buffers to disk */
    if (!FlushFileBuffers((HANDLE)_get_osfhandle(_fileno(fp)))) {
        fprintf(stderr, "Warning: FlushFileBuffers failed\n");
    }
#endif

    fclose(fp);

    if (written != output.size()) {
      fprintf(stderr, "Error: Failed to write complete binary (%zu of %zu bytes)\n",
              written, output.size());
      unlink(tmpfile);
      return BINJECT_ERROR_WRITE_FAILED;
    }

    // Verify file was written.
    result = binject::verify_file_written(tmpfile);
    if (result != BINJECT_OK) {
        return result;
    }

    // Set executable permissions (Unix only).
    result = binject::set_executable_permissions(tmpfile);
    if (result != BINJECT_OK) {
        return result;
    }

    // Atomic rename (handles platform differences internally).
    result = binject::atomic_rename(tmpfile, executable);
    if (result != BINJECT_OK) {
        return result;
    }

    printf("Successfully injected %zu bytes into PE resource %s\n", size, resource_name);
    return BINJECT_OK;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return BINJECT_ERROR;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF PE injection\n");
    return BINJECT_ERROR;
  }
}

/**
 * Batch inject both SEA and VFS resources in a single LIEF pass.
 *
 * CRITICAL CHANGE: Now uses PE resources instead of sections!
 * - Old: Inject into .node_sea_blob and .smol_vfs_blob sections
 * - New: Inject into .rsrc section as RT_RCDATA resources
 * - Why: Node.js uses FindResource/LoadResource APIs on Windows
 *
 * Implementation:
 * - Parse binary ONCE (avoid LIEF memory corruption)
 * - Add ALL resources in single pass
 * - Rebuild with resources ONCE
 * - Write output ONCE
 *
 * Resource names (uppercased for Windows compatibility):
 * - SEA: "NODE_SEA_BLOB" (matches Node.js convention)
 * - VFS: "SMOL_VFS_BLOB" (custom for socket-btm)
 *
 * @param executable Path to the input PE binary.
 * @param output Path to write the modified binary.
 * @param sea_data SEA blob data to inject (or NULL to skip).
 * @param sea_size Size of SEA data in bytes.
 * @param vfs_data VFS blob data to inject (or NULL to skip).
 * @param vfs_size Size of VFS data in bytes.
 * @param vfs_compat_mode If true and vfs_data is NULL, inject 0-byte VFS resource.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_pe_lief_batch(
    const char *executable,
    const char *output,
    const uint8_t *sea_data, size_t sea_size,
    const uint8_t *vfs_data, size_t vfs_size,
    int vfs_compat_mode
) {
  if (!executable || !output) {
    fprintf(stderr, "Error: Invalid arguments (NULL parameter)\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

  try {
    printf("Using LIEF for PE batch resource injection (Windows/Node.js SEA compatible)...\n");

    // Single parse - avoid LIEF memory corruption from multiple parses
    std::unique_ptr<LIEF::PE::Binary> binary =
        LIEF::PE::Parser::parse(executable);

    if (!binary) {
      fprintf(stderr, "Error: Failed to parse PE binary: %s\n", executable);
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Note: For resources, we don't check for existing NODE_SEA section
    // because we're using resources, not sections. The inject_pe_resource
    // function handles overwriting existing resources automatically.

    // Flip NODE_SEA_FUSE if needed (uses template from binject_sea_fuse.hpp)
    // This still applies because the fuse is in the binary's data section
    binject::flip_fuse_if_needed(binary.get(), sea_data, sea_size);

    // Inject SEA resource if provided
    if (sea_data && sea_size > 0) {
      printf("Injecting SEA resource: %s\n", PE_RESOURCE_NODE_SEA_BLOB);
      int result = inject_pe_resource(binary.get(), PE_RESOURCE_NODE_SEA_BLOB,
                                       sea_data, sea_size, true);
      if (result != BINJECT_OK) {
        return result;
      }
    }

    // Inject VFS resource if provided (or 0-byte in compat mode)
    if (vfs_data || vfs_compat_mode) {
      if (vfs_compat_mode && vfs_size == 0) {
        printf("Injecting empty VFS resource (0 bytes, compatibility mode)\n");
        // Inject 0-byte resource (NULL data, size 0)
        int result = inject_pe_resource(binary.get(), PE_RESOURCE_SMOL_VFS_BLOB,
                                         nullptr, 0, true);
        if (result != BINJECT_OK) {
          return result;
        }
      } else if (vfs_data && vfs_size > 0) {
        printf("Injecting VFS resource: %s\n", PE_RESOURCE_SMOL_VFS_BLOB);
        int result = inject_pe_resource(binary.get(), PE_RESOURCE_SMOL_VFS_BLOB,
                                         vfs_data, vfs_size, true);
        if (result != BINJECT_OK) {
          return result;
        }
      }
    }

    // Rebuild binary with resources
    std::vector<uint8_t> rebuilt = rebuild_pe_with_resources(binary.get());
    if (rebuilt.empty()) {
      fprintf(stderr, "Error: Failed to rebuild PE binary with resources\n");
      return BINJECT_ERROR;
    }

    // Create parent directories if needed
    if (create_parent_directories(output) != 0) {
      fprintf(stderr, "Error: Failed to create parent directories for output: %s\n", output);
      return BINJECT_ERROR;
    }

    // Write to temp file first, then atomic rename
    char tmpfile[PATH_MAX];
    binject::create_temp_path(output, tmpfile, sizeof(tmpfile));

    // Write output to temp file
    printf("Writing modified PE binary to temp file...\n");
    FILE* fp = fopen(tmpfile, "wb");
    if (!fp) {
      fprintf(stderr, "Error: Failed to open temp file for writing: %s\n", tmpfile);
      return BINJECT_ERROR_WRITE_FAILED;
    }

    size_t written = fwrite(rebuilt.data(), 1, rebuilt.size(), fp);

    /* Ensure binary is fully written to disk before rename to prevent race condition */
#ifndef _WIN32
    int fd = fileno(fp);
    if (fsync(fd) != 0) {
        fprintf(stderr, "Warning: fsync failed: %s\n", strerror(errno));
    }
#else
    /* Windows: Flush file buffers to disk */
    if (!FlushFileBuffers((HANDLE)_get_osfhandle(_fileno(fp)))) {
        fprintf(stderr, "Warning: FlushFileBuffers failed\n");
    }
#endif

    fclose(fp);

    if (written != rebuilt.size()) {
      fprintf(stderr, "Error: Failed to write complete binary (%zu of %zu bytes)\n",
              written, rebuilt.size());
      unlink(tmpfile);
      return BINJECT_ERROR_WRITE_FAILED;
    }

    // Verify file was actually written
    int result = binject::verify_file_written(tmpfile);
    if (result != BINJECT_OK) {
      return result;
    }

    // Set executable permissions (Unix only)
    result = binject::set_executable_permissions(tmpfile);
    if (result != BINJECT_OK) {
      return result;
    }

    // Atomic rename to final destination
    result = binject::atomic_rename(tmpfile, output);
    if (result != BINJECT_OK) {
      return result;
    }

    printf("Successfully injected resources into PE binary\n");
    return BINJECT_OK;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return BINJECT_ERROR;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF PE batch injection\n");
    return BINJECT_ERROR;
  }
}

/**
 * List PE sections of interest using LIEF (cross-platform).
 */
extern "C" int binject_pe_list_lief(const char* executable) {
  // Use template from binject_section_ops.hpp (Phase 4 refactoring)
  // Replaces ~60 lines of duplicate code with single template call
  return binject::list_sections<LIEF::PE::Binary>(executable);
}

/**
 * Extract section from PE binary using LIEF (cross-platform).
 */
extern "C" int binject_pe_extract_lief(const char* executable, const char* section_name, const char* output_file) {
  // Use template from binject_section_ops.hpp (Phase 4 refactoring)
  // Replaces ~57 lines of duplicate code with single template call
  return binject::extract_section<LIEF::PE::Binary>(executable, section_name, output_file);
}

/**
 * Verify section exists in PE binary using LIEF (cross-platform).
 */
extern "C" int binject_pe_verify_lief(const char* executable, const char* section_name) {
  // Use template from binject_section_ops.hpp (Phase 4 refactoring)
  // Replaces ~34 lines of duplicate code with single template call
  return binject::verify_section<LIEF::PE::Binary>(executable, section_name);
}
