#include "socketsecurity/vfs/node_vfs.h"

#include "debug_utils-inl.h"
#include "env-inl.h"
#include "node_errors.h"
#include "node_external_reference.h"
#include "node_internals.h"
#include "util-inl.h"
#include "socketsecurity/build-infra/debug_common.h"
#include "socketsecurity/build-infra/file_io_common.h"
#include "socketsecurity/binject/vfs_config.h"

// Use the same sentinel fuse as SEA for compatibility
#define POSTJECT_SENTINEL_FUSE "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
#include "postject-api.h"
#undef POSTJECT_SENTINEL_FUSE

#include <memory>
#include <string_view>

// Linux-specific includes for memfd_create
#ifdef __linux__
#include <sys/mman.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>
#endif

using v8::ArrayBuffer;
using v8::BackingStore;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::Value;

namespace node {
namespace smol_vfs {

// VFS section detection - call postject_find_resource only once during static init.
// Returns: {blob_pointer, size, section_exists}
struct VFSInfo {
  const char* blob;
  size_t size;
  bool section_exists;
};

static VFSInfo GetVFSInfo() {
  static const VFSInfo result = []() -> VFSInfo {
    size_t size = 0;

    // Configure postject to look in NODE_SEA segment (not default __POSTJECT)
    postject_options options;
    postject_options_init(&options);
    options.macho_segment_name = "NODE_SEA";
    options.macho_section_name = "__SMOL_VFS_BLOB";

    const char* blob = static_cast<const char*>(
        postject_find_resource("SMOL_VFS_BLOB",
                               &size,
                               &options));

    return {blob, size, blob != nullptr};
  }();

  return result;
}

// Find SMOL_VFS_BLOB resource injected via binject
// Note: Mach-O section names are limited to 16 characters
// VFS data is stored in NODE_SEA segment's __SMOL_VFS_BLOB section
// Returns empty string_view if section doesn't exist or is 0 bytes (compat mode)
static std::string_view FindVFSBlob() {
  const VFSInfo info = GetVFSInfo();

  // Return empty if section doesn't exist OR if size is 0 (compat mode)
  if (!info.section_exists || info.size == 0) {
    return {};
  }

  return {info.blob, info.size};
}

bool HasVFSBlob() {
  // Use section existence as the flag, not blob size
  return GetVFSInfo().section_exists;
}

// VFS config detection - call postject_find_resource only once during static init.
// Returns: {blob_pointer, size, section_exists}
struct VFSConfigInfo {
  const char* blob;
  size_t size;
  bool section_exists;
};

static VFSConfigInfo GetVFSConfigInfo() {
  static const VFSConfigInfo result = []() -> VFSConfigInfo {
    DEBUG_LOG("GetVFSConfigInfo: START\n");
    size_t size = 0;

    // Configure postject to look in NODE_SEA segment
    DEBUG_LOG("GetVFSConfigInfo: Initializing postject options\n");
    postject_options options;
    postject_options_init(&options);
    options.macho_segment_name = "NODE_SEA";
    options.macho_section_name = "__SMOL_VFS_CONFIG";

    DEBUG_LOG("GetVFSConfigInfo: Calling postject_find_resource for SMOL_VFS_CONFIG\n");
    const char* blob = static_cast<const char*>(
        postject_find_resource("SMOL_VFS_CONFIG",
                               &size,
                               &options));

    DEBUG_LOG("GetVFSConfigInfo: postject_find_resource returned blob=%p size=%zu\n",
            (void*)blob, size);

    return {blob, size, blob != nullptr};
  }();

  DEBUG_LOG("GetVFSConfigInfo: Returning cached result\n");
  return result;
}

// Helper: Read little-endian uint16_t
static uint16_t read_le16(const uint8_t* data) {
  return static_cast<uint16_t>(data[0]) |
         (static_cast<uint16_t>(data[1]) << 8);
}

// Helper: Read little-endian uint32_t
static uint32_t read_le32(const uint8_t* data) {
  return static_cast<uint32_t>(data[0]) |
         (static_cast<uint32_t>(data[1]) << 8) |
         (static_cast<uint32_t>(data[2]) << 16) |
         (static_cast<uint32_t>(data[3]) << 24);
}

// Deserialize VFS config from SVFG format
// Returns null object if config not found or invalid
static bool DeserializeVFSConfig(const char* data,
                                 std::string& mode,
                                 std::string& source,
                                 std::string& prefix) {
  DEBUG_LOG("DeserializeVFSConfig: START data=%p\n", (void*)data);
  if (!data) {
    DEBUG_LOG("DeserializeVFSConfig: data is NULL, returning false\n");
    return false;
  }

  const uint8_t* buf = reinterpret_cast<const uint8_t*>(data);
  size_t offset = 0;

  // Validate magic (4 bytes, little-endian)
  DEBUG_LOG("DeserializeVFSConfig: Reading magic at offset %zu\n", offset);
  uint32_t magic = read_le32(buf + offset);
  offset += 4;
  DEBUG_LOG("DeserializeVFSConfig: magic=0x%08X (expected 0x%08X)\n", magic, VFS_CONFIG_MAGIC);
  if (magic != VFS_CONFIG_MAGIC) {
    DEBUG_LOG("DeserializeVFSConfig: Invalid magic, returning false\n");
    return false;
  }

  // Validate version (2 bytes, little-endian)
  DEBUG_LOG("DeserializeVFSConfig: Reading version at offset %zu\n", offset);
  uint16_t version = read_le16(buf + offset);
  offset += 2;
  DEBUG_LOG("DeserializeVFSConfig: version=%u (expected %u)\n", version, VFS_CONFIG_VERSION);
  if (version != VFS_CONFIG_VERSION) {
    DEBUG_LOG("DeserializeVFSConfig: Invalid version, returning false\n");
    return false;
  }

  // Skip padding (2 bytes)
  offset += 2;
  DEBUG_LOG("DeserializeVFSConfig: Skipped padding, offset now %zu\n", offset);

  // Read mode (2-byte length prefix + up to 32 bytes)
  DEBUG_LOG("DeserializeVFSConfig: Reading mode length at offset %zu\n", offset);
  uint16_t mode_len = read_le16(buf + offset);
  offset += 2;
  DEBUG_LOG("DeserializeVFSConfig: mode_len=%u (max %u)\n", mode_len, MAX_VFS_MODE_LEN);
  if (mode_len > MAX_VFS_MODE_LEN) {
    DEBUG_LOG("DeserializeVFSConfig: mode_len too large, returning false\n");
    return false;
  }
  mode.assign(reinterpret_cast<const char*>(buf + offset), mode_len);
  offset += MAX_VFS_MODE_LEN;
  DEBUG_LOG("DeserializeVFSConfig: mode='%s'\n", mode.c_str());

  // Read source (2-byte length prefix + up to 256 bytes)
  DEBUG_LOG("DeserializeVFSConfig: Reading source length at offset %zu\n", offset);
  uint16_t source_len = read_le16(buf + offset);
  offset += 2;
  DEBUG_LOG("DeserializeVFSConfig: source_len=%u (max %u)\n", source_len, MAX_VFS_SOURCE_LEN);
  if (source_len > MAX_VFS_SOURCE_LEN) {
    DEBUG_LOG("DeserializeVFSConfig: source_len too large, returning false\n");
    return false;
  }
  source.assign(reinterpret_cast<const char*>(buf + offset), source_len);
  offset += MAX_VFS_SOURCE_LEN;
  DEBUG_LOG("DeserializeVFSConfig: source='%s'\n", source.c_str());

  // Read prefix (2-byte length prefix + up to 64 bytes)
  DEBUG_LOG("DeserializeVFSConfig: Reading prefix length at offset %zu\n", offset);
  uint16_t prefix_len = read_le16(buf + offset);
  offset += 2;
  DEBUG_LOG("DeserializeVFSConfig: prefix_len=%u (max %u)\n", prefix_len, MAX_VFS_PREFIX_LEN);
  if (prefix_len > MAX_VFS_PREFIX_LEN) {
    DEBUG_LOG("DeserializeVFSConfig: prefix_len too large, returning false\n");
    return false;
  }
  prefix.assign(reinterpret_cast<const char*>(buf + offset), prefix_len);
  offset += MAX_VFS_PREFIX_LEN;
  DEBUG_LOG("DeserializeVFSConfig: prefix='%s'\n", prefix.c_str());

  DEBUG_LOG("DeserializeVFSConfig: SUCCESS, returning true\n");
  return true;
}

// JavaScript binding: internalBinding('smol_vfs').getVFSBlob()
static void GetVFSBlob(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  std::string_view blob = FindVFSBlob();
  if (blob.empty()) {
    return;  // Return undefined if no VFS blob
  }

  // Create ArrayBuffer with VFS blob data
  std::unique_ptr<BackingStore> backing = ArrayBuffer::NewBackingStore(
      const_cast<char*>(blob.data()),
      blob.size(),
      [](void*, size_t, void*) {
        // No-op deleter since data is static
      },
      nullptr);

  Local<ArrayBuffer> array_buffer = ArrayBuffer::New(isolate, std::move(backing));
  args.GetReturnValue().Set(array_buffer);
}

// JavaScript binding: internalBinding('smol_vfs').hasVFSBlob()
static void HasVFSBlobBinding(const FunctionCallbackInfo<Value>& args) {
  args.GetReturnValue().Set(HasVFSBlob());
}

// JavaScript binding: internalBinding('smol_vfs').canBuildSea()
// Returns true if Node.js was built with LIEF support (--with-lief=true)
static void CanBuildSeaBinding(const FunctionCallbackInfo<Value>& args) {
#ifdef HAVE_LIEF
  args.GetReturnValue().Set(true);
#else
  args.GetReturnValue().Set(false);
#endif
}

// JavaScript binding: internalBinding('smol_vfs').getVFSConfig()
// Returns {mode, source, prefix} object or undefined if config not found
static void GetVFSConfig(const FunctionCallbackInfo<Value>& args) {
  DEBUG_LOG("GetVFSConfig: JavaScript binding called\n");
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  DEBUG_LOG("GetVFSConfig: Calling GetVFSConfigInfo()\n");
  const VFSConfigInfo info = GetVFSConfigInfo();
  DEBUG_LOG("GetVFSConfig: section_exists=%d size=%zu (expected %d)\n",
          info.section_exists, info.size, VFS_CONFIG_SIZE);

  if (!info.section_exists || info.size != VFS_CONFIG_SIZE) {
    DEBUG_LOG("GetVFSConfig: Config not found or wrong size, returning undefined\n");
    return;  // Return undefined if config not found or wrong size
  }

  // Deserialize SVFG format
  DEBUG_LOG("GetVFSConfig: Calling DeserializeVFSConfig()\n");
  std::string mode, source, prefix;
  if (!DeserializeVFSConfig(info.blob, mode, source, prefix)) {
    DEBUG_LOG("GetVFSConfig: Deserialization failed, returning undefined\n");
    return;  // Return undefined if deserialization failed
  }

  // Create JavaScript object {mode, source, prefix}
  DEBUG_LOG("GetVFSConfig: Creating JavaScript object\n");
  Local<Object> config_obj = Object::New(isolate);

  Local<v8::String> mode_str = node::OneByteString(isolate, mode.c_str(), mode.length());
  Local<v8::String> source_str = node::OneByteString(isolate, source.c_str(), source.length());
  Local<v8::String> prefix_str = node::OneByteString(isolate, prefix.c_str(), prefix.length());

  config_obj->Set(context,
                  node::FIXED_ONE_BYTE_STRING(isolate, "mode"),
                  mode_str).Check();
  config_obj->Set(context,
                  node::FIXED_ONE_BYTE_STRING(isolate, "source"),
                  source_str).Check();
  config_obj->Set(context,
                  node::FIXED_ONE_BYTE_STRING(isolate, "prefix"),
                  prefix_str).Check();

  DEBUG_LOG("GetVFSConfig: Returning config object\n");
  args.GetReturnValue().Set(config_obj);
}

#ifdef __linux__
// JavaScript binding: internalBinding('smol_vfs').createMemfd(name, content)
// Creates anonymous memory-backed file descriptor using memfd_create.
// Returns path to /proc/self/fd/<fd> that can be used like a regular file path.
// This enables true in-memory extraction without tmpfs disk I/O.
static void CreateMemfd(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Environment* env = Environment::GetCurrent(isolate);

  // Validate arguments
  if (args.Length() < 2) {
    THROW_ERR_MISSING_ARGS(env, "createMemfd requires 2 arguments (name, content)");
    return;
  }

  if (!args[0]->IsString()) {
    THROW_ERR_INVALID_ARG_TYPE(env, "name must be a string");
    return;
  }

  if (!args[1]->IsArrayBufferView() && !args[1]->IsArrayBuffer()) {
    THROW_ERR_INVALID_ARG_TYPE(env, "content must be a Buffer or ArrayBuffer");
    return;
  }

  // Extract name
  node::Utf8Value name_utf8(isolate, args[0]);
  const char* name = *name_utf8;

  // Extract content buffer
  Local<Value> buffer_val = args[1];
  char* data;
  size_t length;

  if (buffer_val->IsArrayBufferView()) {
    Local<v8::ArrayBufferView> view = buffer_val.As<v8::ArrayBufferView>();
    Local<v8::ArrayBuffer> ab = view->Buffer();
    data = static_cast<char*>(ab->Data()) + view->ByteOffset();
    length = view->ByteLength();
  } else {
    Local<v8::ArrayBuffer> ab = buffer_val.As<v8::ArrayBuffer>();
    data = static_cast<char*>(ab->Data());
    length = ab->ByteLength();
  }

  // Create memfd (requires Linux kernel >= 3.17)
  // MFD_CLOEXEC: Close on exec (security best practice)
  // MFD_ALLOW_SEALING: Allow sealing operations (optional, for immutability)
  int fd = memfd_create(name, MFD_CLOEXEC);

  if (fd == -1) {
    // memfd_create failed - return undefined to signal fallback to tmpfs
    // Common causes: kernel < 3.17, seccomp filter, restricted container
    DEBUG_LOG("[VFS] memfd_create failed for '%s': %s (errno=%d), falling back to tmpfs\n",
              name, strerror(errno), errno);
    return;
  }

  // Write content to memfd
  ssize_t written = write_eintr(fd, data, length);
  if (written != static_cast<ssize_t>(length)) {
    close(fd);
    return;  // Write failed - return undefined
  }

  // Seek back to beginning so file can be read
  if (lseek(fd, 0, SEEK_SET) == -1) {
    close(fd);
    return;
  }

  // Return path to /proc/self/fd/<fd>
  // This path can be used like a regular file path for dlopen(), require(), etc.
  char fd_path[64];
  snprintf(fd_path, sizeof(fd_path), "/proc/self/fd/%d", fd);

  Local<v8::String> result = node::OneByteString(isolate, fd_path);
  args.GetReturnValue().Set(result);

  // Note: fd is NOT closed here - it stays open for the lifetime of the process.
  // The file descriptor will be automatically closed when the process exits.
  // This is intentional - the fd must remain open for /proc/self/fd/<fd> to work.
}
#endif  // __linux__

static void Initialize(Local<Object> target,
                       Local<Value> unused,
                       Local<Context> context,
                       void* priv) {
  DEBUG_INIT("smol:vfs");
  SetMethod(context, target, "getVFSBlob", GetVFSBlob);
  SetMethod(context, target, "hasVFSBlob", HasVFSBlobBinding);
  SetMethod(context, target, "canBuildSea", CanBuildSeaBinding);
  SetMethod(context, target, "getVFSConfig", GetVFSConfig);
#ifdef __linux__
  SetMethod(context, target, "createMemfd", CreateMemfd);
#endif
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(GetVFSBlob);
  registry->Register(HasVFSBlobBinding);
  registry->Register(CanBuildSeaBinding);
  registry->Register(GetVFSConfig);
#ifdef __linux__
  registry->Register(CreateMemfd);
#endif
}

}  // namespace smol_vfs
}  // namespace node

// Register as internal binding (like all Node.js bindings)
// Access via process.binding() is enabled by adding to processBindingAllowList
NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_vfs, node::smol_vfs::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(smol_vfs, node::smol_vfs::RegisterExternalReferences)
