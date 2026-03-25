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
#include "socketsecurity/bin-infra/segment_names.h"
#include "socketsecurity/simd/simd.h"

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
    options.macho_section_name = MACHO_SECTION_SMOL_VFS_CONFIG;

    DEBUG_LOG("GetVFSConfigInfo: Calling postject_find_resource for SMOL_VFS_CFG\n");
    const char* blob = static_cast<const char*>(
        postject_find_resource(SMOL_VFS_CONFIG_RESOURCE_NAME,
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
          info.section_exists, info.size, VFS_CFG_SIZE);

  if (!info.section_exists || info.size != VFS_CFG_SIZE) {
    DEBUG_LOG("GetVFSConfig: Config not found or wrong size, returning undefined\n");
    return;  // Return undefined if config not found or wrong size
  }

  // Deserialize SVFG format
  DEBUG_LOG("GetVFSConfig: Calling DeserializeVFSConfig()\n");
  std::string mode, prefix;
  if (!DeserializeVFSConfig(info.blob, mode, prefix)) {
    DEBUG_LOG("GetVFSConfig: Deserialization failed, returning undefined\n");
    return;  // Return undefined if deserialization failed
  }

  // Create JavaScript object {mode, prefix}
  DEBUG_LOG("GetVFSConfig: Creating JavaScript object\n");
  Local<Object> config_obj = Object::New(isolate);

  Local<v8::String> mode_str = node::OneByteString(isolate, mode.c_str(), mode.length());
  Local<v8::String> prefix_str = node::OneByteString(isolate, prefix.c_str(), prefix.length());

  config_obj->Set(context,
                  node::FIXED_ONE_BYTE_STRING(isolate, "mode"),
                  mode_str).Check();
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

// ============================================================================
// SIMD-accelerated TAR utilities
// ============================================================================
namespace tar {

// TAR header checksum calculation (512 bytes)
// Checksum field (bytes 148-155) is treated as 8 spaces (ASCII 32)
uint32_t CalculateChecksum(const uint8_t* header) {
  uint32_t sum = 0;

#if SMOL_HAS_SSE2
  // SIMD path: process 16 bytes at a time
  __m128i acc = _mm_setzero_si128();
  __m128i zero = _mm_setzero_si128();

  // Process bytes 0-143 (9 chunks of 16 bytes = 144 bytes)
  for (int i = 0; i < 144; i += 16) {
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(header + i));
    // Unpack to 16-bit integers and accumulate
    __m128i lo = _mm_unpacklo_epi8(chunk, zero);
    __m128i hi = _mm_unpackhi_epi8(chunk, zero);
    acc = _mm_add_epi32(acc, _mm_add_epi32(
        _mm_add_epi32(_mm_unpacklo_epi16(lo, zero), _mm_unpackhi_epi16(lo, zero)),
        _mm_add_epi32(_mm_unpacklo_epi16(hi, zero), _mm_unpackhi_epi16(hi, zero))));
  }

  // Add bytes 144-147 (4 bytes before checksum field)
  sum += header[144] + header[145] + header[146] + header[147];

  // Checksum field (148-155) treated as 8 spaces (8 * 32 = 256)
  sum += 256;

  // Process bytes 156-511 (22 chunks of 16 bytes = 352 bytes, but we need 356)
  for (int i = 156; i + 16 <= 512; i += 16) {
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(header + i));
    __m128i lo = _mm_unpacklo_epi8(chunk, zero);
    __m128i hi = _mm_unpackhi_epi8(chunk, zero);
    acc = _mm_add_epi32(acc, _mm_add_epi32(
        _mm_add_epi32(_mm_unpacklo_epi16(lo, zero), _mm_unpackhi_epi16(lo, zero)),
        _mm_add_epi32(_mm_unpacklo_epi16(hi, zero), _mm_unpackhi_epi16(hi, zero))));
  }

  // Remaining bytes 508-511 (4 bytes)
  sum += header[508] + header[509] + header[510] + header[511];

  // Horizontal sum of SIMD accumulator
  __m128i sum1 = _mm_add_epi32(acc, _mm_srli_si128(acc, 8));
  __m128i sum2 = _mm_add_epi32(sum1, _mm_srli_si128(sum1, 4));
  sum += static_cast<uint32_t>(_mm_cvtsi128_si32(sum2));

#elif SMOL_HAS_NEON
  // NEON path: process 16 bytes at a time
  uint32x4_t acc = vdupq_n_u32(0);

  // Process bytes 0-143
  for (int i = 0; i < 144; i += 16) {
    uint8x16_t chunk = vld1q_u8(header + i);
    uint16x8_t lo = vmovl_u8(vget_low_u8(chunk));
    uint16x8_t hi = vmovl_u8(vget_high_u8(chunk));
    acc = vaddq_u32(acc, vaddl_u16(vget_low_u16(lo), vget_high_u16(lo)));
    acc = vaddq_u32(acc, vaddl_u16(vget_low_u16(hi), vget_high_u16(hi)));
  }

  // Add bytes 144-147
  sum += header[144] + header[145] + header[146] + header[147];

  // Checksum field
  sum += 256;

  // Process bytes 156-507
  for (int i = 156; i + 16 <= 508; i += 16) {
    uint8x16_t chunk = vld1q_u8(header + i);
    uint16x8_t lo = vmovl_u8(vget_low_u8(chunk));
    uint16x8_t hi = vmovl_u8(vget_high_u8(chunk));
    acc = vaddq_u32(acc, vaddl_u16(vget_low_u16(lo), vget_high_u16(lo)));
    acc = vaddq_u32(acc, vaddl_u16(vget_low_u16(hi), vget_high_u16(hi)));
  }

  // Remaining bytes
  for (int i = 504; i < 512; i++) {
    sum += header[i];
  }

  // Horizontal sum
  sum += vgetq_lane_u32(acc, 0) + vgetq_lane_u32(acc, 1) +
         vgetq_lane_u32(acc, 2) + vgetq_lane_u32(acc, 3);

#else
  // Scalar fallback
  // Sum bytes before checksum field (0 to 147)
  for (int i = 0; i < 148; i++) {
    sum += header[i];
  }
  // Checksum field (148 to 155) treated as 8 spaces
  sum += 256;
  // Sum bytes after checksum field (156 to 511)
  for (int i = 156; i < 512; i++) {
    sum += header[i];
  }
#endif

  return sum;
}

// Check if a 512-byte TAR block is all zeros (end of archive marker)
bool IsZeroBlock(const uint8_t* block) {
#if SMOL_HAS_AVX2
  if (smol::simd::g_has_avx2) {
    __m256i zero = _mm256_setzero_si256();
    for (int i = 0; i < 512; i += 32) {
      __m256i chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(block + i));
      if (!_mm256_testz_si256(chunk, chunk)) {
        return false;
      }
    }
    return true;
  }
#endif

#if SMOL_HAS_SSE2
  __m128i zero = _mm_setzero_si128();
  for (int i = 0; i < 512; i += 16) {
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(block + i));
    if (_mm_movemask_epi8(_mm_cmpeq_epi8(chunk, zero)) != 0xFFFF) {
      return false;
    }
  }
  return true;

#elif SMOL_HAS_NEON
  uint8x16_t zero = vdupq_n_u8(0);
  for (int i = 0; i < 512; i += 16) {
    uint8x16_t chunk = vld1q_u8(block + i);
    uint8x16_t cmp = vceqq_u8(chunk, zero);
    // Check if all bytes are equal to zero
    uint64x2_t cmp64 = vreinterpretq_u64_u8(cmp);
    if (vgetq_lane_u64(cmp64, 0) != ~0ULL || vgetq_lane_u64(cmp64, 1) != ~0ULL) {
      return false;
    }
  }
  return true;

#else
  // Scalar fallback
  for (int i = 0; i < 512; i++) {
    if (block[i] != 0) {
      return false;
    }
  }
  return true;
#endif
}

// Parse octal string from TAR header field
int64_t ParseOctal(const uint8_t* data, size_t len) {
  int64_t result = 0;
  size_t i = 0;

  // Skip leading spaces
  while (i < len && data[i] == ' ') {
    i++;
  }

  // Parse octal digits
  while (i < len && data[i] >= '0' && data[i] <= '7') {
    result = (result << 3) | (data[i] - '0');
    i++;
  }

  return result;
}

}  // namespace tar

// JavaScript bindings for TAR utilities
static void TarCalculateChecksum(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Environment* env = Environment::GetCurrent(isolate);

  if (args.Length() < 2) {
    THROW_ERR_MISSING_ARGS(env, "tarCalculateChecksum requires 2 arguments (buffer, offset)");
    return;
  }

  if (!args[0]->IsArrayBufferView() && !args[0]->IsArrayBuffer()) {
    THROW_ERR_INVALID_ARG_TYPE(env, "buffer must be a Buffer or ArrayBuffer");
    return;
  }

  Local<Value> buffer_val = args[0];
  const uint8_t* data;
  size_t length;

  if (buffer_val->IsArrayBufferView()) {
    Local<v8::ArrayBufferView> view = buffer_val.As<v8::ArrayBufferView>();
    Local<v8::ArrayBuffer> ab = view->Buffer();
    data = static_cast<const uint8_t*>(ab->Data()) + view->ByteOffset();
    length = view->ByteLength();
  } else {
    Local<v8::ArrayBuffer> ab = buffer_val.As<v8::ArrayBuffer>();
    data = static_cast<const uint8_t*>(ab->Data());
    length = ab->ByteLength();
  }

  uint32_t offset = args[1]->Uint32Value(isolate->GetCurrentContext()).FromMaybe(0);

  if (offset + 512 > length) {
    THROW_ERR_OUT_OF_RANGE(env, "offset + 512 exceeds buffer length");
    return;
  }

  uint32_t checksum = tar::CalculateChecksum(data + offset);
  args.GetReturnValue().Set(checksum);
}

static void TarIsZeroBlock(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Environment* env = Environment::GetCurrent(isolate);

  if (args.Length() < 2) {
    THROW_ERR_MISSING_ARGS(env, "tarIsZeroBlock requires 2 arguments (buffer, offset)");
    return;
  }

  if (!args[0]->IsArrayBufferView() && !args[0]->IsArrayBuffer()) {
    THROW_ERR_INVALID_ARG_TYPE(env, "buffer must be a Buffer or ArrayBuffer");
    return;
  }

  Local<Value> buffer_val = args[0];
  const uint8_t* data;
  size_t length;

  if (buffer_val->IsArrayBufferView()) {
    Local<v8::ArrayBufferView> view = buffer_val.As<v8::ArrayBufferView>();
    Local<v8::ArrayBuffer> ab = view->Buffer();
    data = static_cast<const uint8_t*>(ab->Data()) + view->ByteOffset();
    length = view->ByteLength();
  } else {
    Local<v8::ArrayBuffer> ab = buffer_val.As<v8::ArrayBuffer>();
    data = static_cast<const uint8_t*>(ab->Data());
    length = ab->ByteLength();
  }

  uint32_t offset = args[1]->Uint32Value(isolate->GetCurrentContext()).FromMaybe(0);

  if (offset + 512 > length) {
    THROW_ERR_OUT_OF_RANGE(env, "offset + 512 exceeds buffer length");
    return;
  }

  bool is_zero = tar::IsZeroBlock(data + offset);
  args.GetReturnValue().Set(is_zero);
}

static void TarParseOctal(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Environment* env = Environment::GetCurrent(isolate);

  if (args.Length() < 3) {
    THROW_ERR_MISSING_ARGS(env, "tarParseOctal requires 3 arguments (buffer, offset, length)");
    return;
  }

  if (!args[0]->IsArrayBufferView() && !args[0]->IsArrayBuffer()) {
    THROW_ERR_INVALID_ARG_TYPE(env, "buffer must be a Buffer or ArrayBuffer");
    return;
  }

  Local<Value> buffer_val = args[0];
  const uint8_t* data;
  size_t buf_length;

  if (buffer_val->IsArrayBufferView()) {
    Local<v8::ArrayBufferView> view = buffer_val.As<v8::ArrayBufferView>();
    Local<v8::ArrayBuffer> ab = view->Buffer();
    data = static_cast<const uint8_t*>(ab->Data()) + view->ByteOffset();
    buf_length = view->ByteLength();
  } else {
    Local<v8::ArrayBuffer> ab = buffer_val.As<v8::ArrayBuffer>();
    data = static_cast<const uint8_t*>(ab->Data());
    buf_length = ab->ByteLength();
  }

  Local<Context> context = isolate->GetCurrentContext();
  uint32_t offset = args[1]->Uint32Value(context).FromMaybe(0);
  uint32_t len = args[2]->Uint32Value(context).FromMaybe(0);

  if (offset + len > buf_length) {
    THROW_ERR_OUT_OF_RANGE(env, "offset + length exceeds buffer length");
    return;
  }

  int64_t result = tar::ParseOctal(data + offset, len);
  args.GetReturnValue().Set(static_cast<double>(result));
}

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

  // SIMD-accelerated TAR utilities
  SetMethod(context, target, "tarCalculateChecksum", TarCalculateChecksum);
  SetMethod(context, target, "tarIsZeroBlock", TarIsZeroBlock);
  SetMethod(context, target, "tarParseOctal", TarParseOctal);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(GetVFSBlob);
  registry->Register(HasVFSBlobBinding);
  registry->Register(CanBuildSeaBinding);
  registry->Register(GetVFSConfig);
#ifdef __linux__
  registry->Register(CreateMemfd);
#endif

  // SIMD-accelerated TAR utilities
  registry->Register(TarCalculateChecksum);
  registry->Register(TarIsZeroBlock);
  registry->Register(TarParseOctal);
}

}  // namespace smol_vfs
}  // namespace node

// Register as internal binding (like all Node.js bindings)
// Access via process.binding() is enabled by adding to processBindingAllowList
NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_vfs, node::smol_vfs::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(smol_vfs, node::smol_vfs::RegisterExternalReferences)
