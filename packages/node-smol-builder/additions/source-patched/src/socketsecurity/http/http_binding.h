// http_binding.h
// High-performance HTTP utilities for node-smol
// Cross-platform: Windows, macOS, Linux (x86_64, ARM64)

#ifndef SRC_SOCKETSECURITY_HTTP_BINDING_H_
#define SRC_SOCKETSECURITY_HTTP_BINDING_H_

// Include shared SIMD utilities (provides platform/arch detection, SIMD intrinsics)
#include "socketsecurity/simd/simd.h"

#include <string>
#include <string_view>
#include <vector>
#include <unordered_map>

// Alias common macros for backwards compatibility
#ifndef SMOL_ALWAYS_INLINE
  #define SMOL_ALWAYS_INLINE SMOL_FORCE_INLINE
#endif

// SMOL_HAS_AVX2 compatibility (smol_simd.h uses SMOL_COMPILE_AVX2)
#if SMOL_COMPILE_AVX2 && !defined(SMOL_HAS_AVX2)
  #define SMOL_HAS_AVX2 1
#endif

namespace smol {
namespace http {

// ============================================================================
// Constants
// ============================================================================

// Pre-computed lookup tables for fast character classification
extern const uint8_t kHexDigits[256];
extern const uint8_t kUrlSafeChars[256];
extern const uint8_t kHeaderNameChars[256];
extern const char kHexCharsLower[16];
extern const char kHexCharsUpper[16];

// Common HTTP header names (interned)
extern const char* const kCommonHeaders[];
extern const size_t kCommonHeadersCount;

// ============================================================================
// URL Parsing
// ============================================================================

struct ParsedUrl {
  std::string_view pathname;
  std::string_view query;
  std::string_view hash;
  bool valid;
};

// Fast URL parsing - zero allocation for simple URLs
ParsedUrl ParseUrl(const char* url, size_t len);

// Parse query string into key-value pairs
// Returns number of pairs parsed, fills output arrays
size_t ParseQueryString(
    const char* qs,
    size_t len,
    std::string_view* keys,
    std::string_view* values,
    size_t max_pairs);

// Decode URI component in-place, returns decoded length
// Input buffer must have space for worst case (same size)
size_t DecodeURIComponent(const char* input, size_t len, char* output);

// Fast check if string needs decoding
bool NeedsDecoding(const char* str, size_t len);

// ============================================================================
// Header Operations
// ============================================================================

// Fast case-insensitive header name comparison
bool HeaderEquals(const char* a, size_t a_len, const char* b, size_t b_len);

// Normalize header name to lowercase (in-place)
void NormalizeHeaderName(char* name, size_t len);

// Get interned header name if common, otherwise nullptr
const char* GetInternedHeaderName(const char* name, size_t len);

// ============================================================================
// WebSocket Frame Operations
// ============================================================================

struct WebSocketFrame {
  uint8_t opcode;
  bool fin;
  bool masked;
  const uint8_t* payload;
  size_t payload_len;
  size_t total_len;  // Total bytes consumed from buffer
  bool valid;
};

// Decode WebSocket frame header and payload
WebSocketFrame DecodeWebSocketFrame(const uint8_t* buffer, size_t len);

// Encode WebSocket frame (server -> client, no masking)
// Returns size written, or 0 if buffer too small
size_t EncodeWebSocketFrame(
    uint8_t* output,
    size_t output_len,
    const uint8_t* payload,
    size_t payload_len,
    uint8_t opcode,
    bool fin = true);

// Unmask WebSocket payload in-place (SIMD accelerated)
void UnmaskPayload(uint8_t* payload, size_t len, uint32_t mask_key);

// ============================================================================
// HTTP Response Building
// ============================================================================

// Pre-built response components
struct ResponseBuilder {
  uint8_t* buffer;
  size_t capacity;
  size_t length;

  ResponseBuilder(uint8_t* buf, size_t cap)
      : buffer(buf), capacity(cap), length(0) {}

  bool WriteStatusLine(int status);
  bool WriteHeader(const char* name, size_t name_len,
                   const char* value, size_t value_len);
  bool WriteContentLength(size_t len);
  bool WriteHeadersEnd();
  bool WriteBody(const uint8_t* body, size_t body_len);

  // Convenience: write complete response
  bool WriteJsonResponse(int status, const char* json, size_t json_len);
  bool WriteTextResponse(int status, const char* text, size_t text_len);
  bool WriteBinaryResponse(int status, const uint8_t* data, size_t data_len,
                           const char* content_type);
};

// Get pre-computed status line for common codes
const char* GetStatusLine(int status, size_t* out_len);

// ============================================================================
// JSON Operations
// ============================================================================

// Check if value can use fast stringify path
// (no custom toJSON, no circular refs, no symbols, simple types)
enum class JsonComplexity {
  kSimple,      // Can use fast path
  kNeedsCheck,  // May have circular refs, need tracking
  kComplex      // Has toJSON, symbols, etc - use V8
};

// Fast JSON stringify for simple objects
// Returns length written, or 0 if buffer too small or object too complex
size_t FastJsonStringify(
    const void* v8_object,  // v8::Local<v8::Object>*
    char* output,
    size_t output_len);

// ============================================================================
// Router (Trie-based)
// ============================================================================

class TrieRouter {
 public:
  TrieRouter();
  ~TrieRouter();

  // Insert route pattern
  // Pattern supports: /static, /:param, /*wildcard
  void Insert(const char* pattern, size_t pattern_len, uint32_t handler_id);

  // Match pathname against routes
  struct MatchResult {
    uint32_t handler_id;
    bool matched;
    // Params stored as offsets into original pathname
    struct Param {
      const char* name;
      size_t name_len;
      size_t value_start;
      size_t value_len;
    };
    Param params[16];  // Max 16 params
    size_t param_count;
  };

  MatchResult Match(const char* pathname, size_t len) const;

 private:
  struct Node;
  Node* root_;
};

// ============================================================================
// Buffer Pool
// ============================================================================

class BufferPool {
 public:
  explicit BufferPool(size_t buffer_size, size_t pool_size = 64);
  ~BufferPool();

  uint8_t* Acquire();
  void Release(uint8_t* buffer);

  size_t buffer_size() const { return buffer_size_; }

 private:
  size_t buffer_size_;
  size_t pool_size_;
  std::vector<uint8_t*> free_list_;
  // No mutex needed - Node.js is single-threaded.
};

// ============================================================================
// SIMD Utilities
// ============================================================================

namespace simd {

// Find character in string (like memchr but potentially faster for short strings)
const char* FindChar(const char* str, size_t len, char c);

// Find any of characters in string
const char* FindAnyOf(const char* str, size_t len, const char* chars, size_t chars_len);

// Compare strings case-insensitively
bool EqualsIgnoreCase(const char* a, size_t a_len, const char* b, size_t b_len);

// Copy with lowercase conversion
void ToLowerCopy(const char* src, char* dst, size_t len);

// XOR buffer with repeating 4-byte key (for WebSocket masking)
void XorRepeat4(uint8_t* data, size_t len, uint32_t key);

}  // namespace simd

// ============================================================================
// V8 Binding Helpers
// ============================================================================

// Initialize the smol_http binding
void Initialize(void* env);  // node::Environment*

}  // namespace http
}  // namespace smol

#endif  // SRC_SOCKETSECURITY_HTTP_BINDING_H_
