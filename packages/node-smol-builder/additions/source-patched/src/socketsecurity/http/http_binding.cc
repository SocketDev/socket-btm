// http_binding.cc
// High-performance HTTP utilities implementation

#include "http_binding.h"
#include "socketsecurity/simd/simd.h"

#include <algorithm>
#include <cstdlib>
#include <new>

#if SMOL_PLATFORM_WINDOWS
  #include <windows.h>
#else
  #include <pthread.h>
#endif

// Initialize shared SIMD detection at startup
namespace {
  struct SIMDInitializer {
    SIMDInitializer() { smol::simd::Init(); }
  };
  static SIMDInitializer g_simd_init;
}

namespace smol {
namespace http {

// ============================================================================
// Lookup Tables
// ============================================================================

// Hex digit values (255 = invalid)
const uint8_t kHexDigits[256] = {
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
    0,  1,  2,  3,  4,  5,  6,  7,  8,  9,255,255,255,255,255,255,  // 0-9
  255, 10, 11, 12, 13, 14, 15,255,255,255,255,255,255,255,255,255,  // A-F
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255, 10, 11, 12, 13, 14, 15,255,255,255,255,255,255,255,255,255,  // a-f
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
};

// Characters that don't need URL encoding
const uint8_t kUrlSafeChars[256] = {
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,  // - .
  1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,  // 0-9
  0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,  // A-O
  1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,1,  // P-Z _
  0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,  // a-o
  1,1,1,1,1,1,1,1,1,1,1,0,0,0,1,0,  // p-z ~
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
};

// Valid HTTP header name characters (token chars per RFC 7230)
const uint8_t kHeaderNameChars[256] = {
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,1,0,1,1,1,1,1,0,0,1,1,0,1,1,0,  // ! # $ % & ' * + - .
  1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,  // 0-9
  0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,  // A-O
  1,1,1,1,1,1,1,1,1,1,1,0,0,0,1,1,  // P-Z ^ _
  1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,  // ` a-o
  1,1,1,1,1,1,1,1,1,1,1,0,1,0,1,0,  // p-z | ~
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
};

const char kHexCharsLower[16] = {
  '0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f'
};

const char kHexCharsUpper[16] = {
  '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F'
};

// Common headers for interning
const char* const kCommonHeaders[] = {
  "accept",
  "accept-encoding",
  "accept-language",
  "authorization",
  "cache-control",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "host",
  "if-modified-since",
  "if-none-match",
  "origin",
  "referer",
  "sec-websocket-key",
  "sec-websocket-version",
  "upgrade",
  "user-agent",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
  "x-request-id",
};
const size_t kCommonHeadersCount = sizeof(kCommonHeaders) / sizeof(kCommonHeaders[0]);

// Pre-computed HTTP status lines
static const struct StatusLine {
  int code;
  const char* line;
  size_t len;
} kStatusLines[] = {
  {200, "HTTP/1.1 200 OK\r\n", 17},
  {201, "HTTP/1.1 201 Created\r\n", 22},
  {204, "HTTP/1.1 204 No Content\r\n", 25},
  {301, "HTTP/1.1 301 Moved Permanently\r\n", 32},
  {302, "HTTP/1.1 302 Found\r\n", 20},
  {304, "HTTP/1.1 304 Not Modified\r\n", 27},
  {400, "HTTP/1.1 400 Bad Request\r\n", 26},
  {401, "HTTP/1.1 401 Unauthorized\r\n", 27},
  {403, "HTTP/1.1 403 Forbidden\r\n", 24},
  {404, "HTTP/1.1 404 Not Found\r\n", 24},
  {405, "HTTP/1.1 405 Method Not Allowed\r\n", 33},
  {500, "HTTP/1.1 500 Internal Server Error\r\n", 36},
  {502, "HTTP/1.1 502 Bad Gateway\r\n", 26},
  {503, "HTTP/1.1 503 Service Unavailable\r\n", 34},
  {0, nullptr, 0}  // sentinel
};

// ============================================================================
// URL Parsing Implementation
// ============================================================================

ParsedUrl ParseUrl(const char* url, size_t len) {
  ParsedUrl result = {{}, {}, {}, true};

  if (SMOL_UNLIKELY(len == 0)) {
    result.pathname = std::string_view("/", 1);
    return result;
  }

  const char* end = url + len;
  const char* p = url;

  // Find query string start
  const char* query_start = nullptr;
  const char* hash_start = nullptr;

  // Scan for ? and # using optimized search
  for (; p < end; ++p) {
    char c = *p;
    if (c == '?') {
      query_start = p;
      break;
    }
    if (c == '#') {
      hash_start = p;
      break;
    }
  }

  // Continue scanning for # if we found ?
  if (query_start && !hash_start) {
    for (const char* q = query_start + 1; q < end; ++q) {
      if (*q == '#') {
        hash_start = q;
        break;
      }
    }
  }

  // Calculate segments
  size_t pathname_end = len;
  if (query_start) pathname_end = query_start - url;
  else if (hash_start) pathname_end = hash_start - url;

  result.pathname = std::string_view(url, pathname_end);

  if (query_start) {
    size_t query_end = hash_start ? (hash_start - query_start - 1) : (end - query_start - 1);
    result.query = std::string_view(query_start + 1, query_end);
  }

  if (hash_start) {
    result.hash = std::string_view(hash_start + 1, end - hash_start - 1);
  }

  return result;
}

size_t ParseQueryString(
    const char* qs,
    size_t len,
    std::string_view* keys,
    std::string_view* values,
    size_t max_pairs) {
  if (len == 0 || max_pairs == 0) return 0;

  size_t count = 0;
  const char* end = qs + len;
  const char* key_start = qs;

  while (key_start < end && count < max_pairs) {
    // Find = or & or end
    const char* p = key_start;
    const char* eq = nullptr;

    while (p < end) {
      char c = *p;
      if (c == '=') {
        eq = p;
        ++p;
        break;
      }
      if (c == '&') {
        break;
      }
      ++p;
    }

    // Find end of value (& or end of string)
    const char* value_end = p;
    while (value_end < end && *value_end != '&') {
      ++value_end;
    }

    // Store key-value pair
    if (eq) {
      keys[count] = std::string_view(key_start, eq - key_start);
      values[count] = std::string_view(eq + 1, value_end - eq - 1);
    } else {
      // Key without value
      keys[count] = std::string_view(key_start, value_end - key_start);
      values[count] = std::string_view();
    }
    ++count;

    // Move to next pair
    key_start = value_end;
    if (key_start < end && *key_start == '&') {
      ++key_start;
    }
  }

  return count;
}

bool NeedsDecoding(const char* str, size_t len) {
  // Quick scan for % or +
  for (size_t i = 0; i < len; ++i) {
    char c = str[i];
    if (c == '%' || c == '+') return true;
  }
  return false;
}

size_t DecodeURIComponent(const char* input, size_t len, char* output) {
  size_t out_len = 0;
  const char* end = input + len;

  while (input < end) {
    char c = *input;

    if (c == '%' && input + 2 < end) {
      uint8_t hi = kHexDigits[static_cast<uint8_t>(input[1])];
      uint8_t lo = kHexDigits[static_cast<uint8_t>(input[2])];

      if (hi != 255 && lo != 255) {
        output[out_len++] = static_cast<char>((hi << 4) | lo);
        input += 3;
        continue;
      }
    } else if (c == '+') {
      output[out_len++] = ' ';
      ++input;
      continue;
    }

    output[out_len++] = c;
    ++input;
  }

  return out_len;
}

// ============================================================================
// Header Operations Implementation
// ============================================================================

bool HeaderEquals(const char* a, size_t a_len, const char* b, size_t b_len) {
  if (a_len != b_len) return false;

  for (size_t i = 0; i < a_len; ++i) {
    char ca = a[i];
    char cb = b[i];

    // Fast case: equal
    if (ca == cb) continue;

    // Case-insensitive comparison for ASCII letters
    if ((ca ^ cb) == 0x20) {
      char lower = ca | 0x20;
      if (lower >= 'a' && lower <= 'z') continue;
    }

    return false;
  }

  return true;
}

void NormalizeHeaderName(char* name, size_t len) {
  // Delegate to shared SIMD implementation
  smol::simd::ToLower(name, len);
}

const char* GetInternedHeaderName(const char* name, size_t len) {
  // Binary search through sorted common headers
  // Note: kCommonHeaders must be sorted alphabetically
  size_t lo = 0;
  size_t hi = kCommonHeadersCount;

  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    const char* candidate = kCommonHeaders[mid];
    size_t cand_len = strlen(candidate);

    int cmp;
    if (len < cand_len) {
      cmp = -1;
    } else if (len > cand_len) {
      cmp = 1;
    } else {
      // Case-insensitive compare
      cmp = 0;
      for (size_t i = 0; i < len; ++i) {
        char a = name[i] | 0x20;  // tolower
        char b = candidate[i];
        if (a < b) { cmp = -1; break; }
        if (a > b) { cmp = 1; break; }
      }
    }

    if (cmp == 0) return candidate;
    if (cmp < 0) hi = mid;
    else lo = mid + 1;
  }

  return nullptr;
}

// ============================================================================
// WebSocket Implementation
// ============================================================================

WebSocketFrame DecodeWebSocketFrame(const uint8_t* buffer, size_t len) {
  WebSocketFrame frame = {};
  frame.valid = false;

  if (len < 2) return frame;

  uint8_t b0 = buffer[0];
  uint8_t b1 = buffer[1];

  frame.fin = (b0 & 0x80) != 0;
  frame.opcode = b0 & 0x0F;
  frame.masked = (b1 & 0x80) != 0;

  size_t payload_len = b1 & 0x7F;
  size_t header_len = 2;

  if (payload_len == 126) {
    if (len < 4) return frame;
    payload_len = (static_cast<size_t>(buffer[2]) << 8) | buffer[3];
    header_len = 4;
  } else if (payload_len == 127) {
    if (len < 10) return frame;
    payload_len = 0;
    for (int i = 0; i < 8; ++i) {
      payload_len = (payload_len << 8) | buffer[2 + i];
    }
    header_len = 10;
  }

  if (frame.masked) {
    header_len += 4;  // mask key
  }

  if (len < header_len + payload_len) return frame;

  frame.payload = buffer + header_len;
  frame.payload_len = payload_len;
  frame.total_len = header_len + payload_len;
  frame.valid = true;

  return frame;
}

size_t EncodeWebSocketFrame(
    uint8_t* output,
    size_t output_len,
    const uint8_t* payload,
    size_t payload_len,
    uint8_t opcode,
    bool fin) {
  size_t header_len;

  if (payload_len < 126) {
    header_len = 2;
  } else if (payload_len < 65536) {
    header_len = 4;
  } else {
    header_len = 10;
  }

  size_t total_len = header_len + payload_len;
  if (output_len < total_len) return 0;

  // Build header
  output[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0F);

  if (payload_len < 126) {
    output[1] = static_cast<uint8_t>(payload_len);
  } else if (payload_len < 65536) {
    output[1] = 126;
    output[2] = static_cast<uint8_t>(payload_len >> 8);
    output[3] = static_cast<uint8_t>(payload_len);
  } else {
    output[1] = 127;
    for (int i = 0; i < 8; ++i) {
      output[2 + i] = static_cast<uint8_t>(payload_len >> (56 - i * 8));
    }
  }

  // Copy payload
  std::memcpy(output + header_len, payload, payload_len);

  return total_len;
}

void UnmaskPayload(uint8_t* payload, size_t len, uint32_t mask_key) {
  // Delegate to shared SIMD implementation
  smol::simd::XorRepeat4(payload, len, mask_key);
}

// ============================================================================
// HTTP Response Builder Implementation
// ============================================================================

const char* GetStatusLine(int status, size_t* out_len) {
  for (const auto& line : kStatusLines) {
    if (line.code == status) {
      *out_len = line.len;
      return line.line;
    }
    if (line.code == 0) break;
  }
  *out_len = 0;
  return nullptr;
}

bool ResponseBuilder::WriteStatusLine(int status) {
  size_t line_len;
  const char* line = GetStatusLine(status, &line_len);

  if (line) {
    if (length + line_len > capacity) return false;
    std::memcpy(buffer + length, line, line_len);
    length += line_len;
    return true;
  }

  // Custom status code
  char buf[64];
  int n = snprintf(buf, sizeof(buf), "HTTP/1.1 %d \r\n", status);
  if (n < 0 || length + static_cast<size_t>(n) > capacity) return false;
  std::memcpy(buffer + length, buf, n);
  length += n;
  return true;
}

bool ResponseBuilder::WriteHeader(
    const char* name, size_t name_len,
    const char* value, size_t value_len) {
  // Format: "Name: Value\r\n"
  size_t needed = name_len + 2 + value_len + 2;
  if (length + needed > capacity) return false;

  std::memcpy(buffer + length, name, name_len);
  length += name_len;
  buffer[length++] = ':';
  buffer[length++] = ' ';
  std::memcpy(buffer + length, value, value_len);
  length += value_len;
  buffer[length++] = '\r';
  buffer[length++] = '\n';
  return true;
}

bool ResponseBuilder::WriteContentLength(size_t len) {
  char buf[32];
  int n = snprintf(buf, sizeof(buf), "%zu", len);
  if (n < 0) return false;
  return WriteHeader("Content-Length", 14, buf, n);
}

bool ResponseBuilder::WriteHeadersEnd() {
  if (length + 2 > capacity) return false;
  buffer[length++] = '\r';
  buffer[length++] = '\n';
  return true;
}

bool ResponseBuilder::WriteBody(const uint8_t* body, size_t body_len) {
  if (length + body_len > capacity) return false;
  std::memcpy(buffer + length, body, body_len);
  length += body_len;
  return true;
}

bool ResponseBuilder::WriteJsonResponse(int status, const char* json, size_t json_len) {
  if (!WriteStatusLine(status)) return false;
  if (!WriteHeader("Content-Type", 12, "application/json", 16)) return false;
  if (!WriteHeader("Connection", 10, "keep-alive", 10)) return false;
  if (!WriteContentLength(json_len)) return false;
  if (!WriteHeadersEnd()) return false;
  return WriteBody(reinterpret_cast<const uint8_t*>(json), json_len);
}

bool ResponseBuilder::WriteTextResponse(int status, const char* text, size_t text_len) {
  if (!WriteStatusLine(status)) return false;
  if (!WriteHeader("Content-Type", 12, "text/plain", 10)) return false;
  if (!WriteHeader("Connection", 10, "keep-alive", 10)) return false;
  if (!WriteContentLength(text_len)) return false;
  if (!WriteHeadersEnd()) return false;
  return WriteBody(reinterpret_cast<const uint8_t*>(text), text_len);
}

bool ResponseBuilder::WriteBinaryResponse(
    int status, const uint8_t* data, size_t data_len, const char* content_type) {
  if (!WriteStatusLine(status)) return false;
  if (!WriteHeader("Content-Type", 12, content_type, std::strlen(content_type))) return false;
  if (!WriteHeader("Connection", 10, "keep-alive", 10)) return false;
  if (!WriteContentLength(data_len)) return false;
  if (!WriteHeadersEnd()) return false;
  return WriteBody(data, data_len);
}

// ============================================================================
// Trie Router Implementation
// ============================================================================

struct TrieRouter::Node {
  enum Type { kStatic, kParam, kWildcard };

  Type type = kStatic;
  std::string segment;           // Static segment text, or param name
  std::unordered_map<std::string, Node*> children;
  Node* param_child = nullptr;   // :param child
  Node* wildcard_child = nullptr;// * child
  uint32_t handler_id = 0;
  bool has_handler = false;

  ~Node() {
    for (auto& kv : children) delete kv.second;
    delete param_child;
    delete wildcard_child;
  }
};

TrieRouter::TrieRouter() : root_(new Node()) {}
TrieRouter::~TrieRouter() { delete root_; }

void TrieRouter::Insert(const char* pattern, size_t pattern_len, uint32_t handler_id) {
  Node* node = root_;
  const char* p = pattern;
  const char* end = pattern + pattern_len;

  while (p < end) {
    // Skip leading slashes
    while (p < end && *p == '/') ++p;
    if (p >= end) break;

    // Find end of segment
    const char* seg_start = p;
    while (p < end && *p != '/') ++p;
    size_t seg_len = p - seg_start;

    if (seg_len == 0) continue;

    if (seg_start[0] == '*') {
      // Wildcard
      if (!node->wildcard_child) {
        node->wildcard_child = new Node();
        node->wildcard_child->type = Node::kWildcard;
        node->wildcard_child->segment = std::string(seg_start + 1, seg_len - 1);
      }
      node = node->wildcard_child;
      break;  // Wildcard consumes rest
    } else if (seg_start[0] == ':') {
      // Param
      if (!node->param_child) {
        node->param_child = new Node();
        node->param_child->type = Node::kParam;
      }
      node->param_child->segment = std::string(seg_start + 1, seg_len - 1);
      node = node->param_child;
    } else {
      // Static
      std::string seg(seg_start, seg_len);
      auto it = node->children.find(seg);
      if (it == node->children.end()) {
        Node* child = new Node();
        child->segment = seg;
        node->children[seg] = child;
        node = child;
      } else {
        node = it->second;
      }
    }
  }

  node->handler_id = handler_id;
  node->has_handler = true;
}

TrieRouter::MatchResult TrieRouter::Match(const char* pathname, size_t len) const {
  MatchResult result = {};
  result.matched = false;

  Node* node = root_;
  const char* p = pathname;
  const char* end = pathname + len;

  while (p < end) {
    // Skip leading slashes
    while (p < end && *p == '/') ++p;
    if (p >= end) break;

    // Find end of segment
    const char* seg_start = p;
    while (p < end && *p != '/') ++p;
    size_t seg_len = p - seg_start;

    if (seg_len == 0) continue;

    std::string seg(seg_start, seg_len);

    // Try static match first
    auto it = node->children.find(seg);
    if (it != node->children.end()) {
      node = it->second;
      continue;
    }

    // Try param match
    if (node->param_child) {
      if (result.param_count < 16) {
        auto& param = result.params[result.param_count++];
        param.name = node->param_child->segment.c_str();
        param.name_len = node->param_child->segment.length();
        param.value_start = seg_start - pathname;
        param.value_len = seg_len;
      }
      node = node->param_child;
      continue;
    }

    // Try wildcard match
    if (node->wildcard_child) {
      if (result.param_count < 16) {
        auto& param = result.params[result.param_count++];
        param.name = node->wildcard_child->segment.empty()
            ? "$wildcard" : node->wildcard_child->segment.c_str();
        param.name_len = node->wildcard_child->segment.empty()
            ? 9 : node->wildcard_child->segment.length();
        param.value_start = seg_start - pathname;
        param.value_len = end - seg_start;
      }
      node = node->wildcard_child;
      break;  // Wildcard consumes rest
    }

    // No match
    return result;
  }

  if (node->has_handler) {
    result.handler_id = node->handler_id;
    result.matched = true;
  }

  return result;
}

// ============================================================================
// Buffer Pool Implementation
// ============================================================================

BufferPool::BufferPool(size_t buffer_size, size_t pool_size)
    : buffer_size_(buffer_size), pool_size_(pool_size) {
#if SMOL_PLATFORM_WINDOWS
  mutex_ = new CRITICAL_SECTION;
  InitializeCriticalSection(static_cast<CRITICAL_SECTION*>(mutex_));
#else
  mutex_ = new pthread_mutex_t;
  pthread_mutex_init(static_cast<pthread_mutex_t*>(mutex_), nullptr);
#endif

  // Pre-allocate some buffers
  for (size_t i = 0; i < pool_size / 2; ++i) {
    free_list_.push_back(static_cast<uint8_t*>(std::malloc(buffer_size)));
  }
}

BufferPool::~BufferPool() {
  for (uint8_t* buf : free_list_) {
    std::free(buf);
  }

#if SMOL_PLATFORM_WINDOWS
  DeleteCriticalSection(static_cast<CRITICAL_SECTION*>(mutex_));
  delete static_cast<CRITICAL_SECTION*>(mutex_);
#else
  pthread_mutex_destroy(static_cast<pthread_mutex_t*>(mutex_));
  delete static_cast<pthread_mutex_t*>(mutex_);
#endif
}

uint8_t* BufferPool::Acquire() {
#if SMOL_PLATFORM_WINDOWS
  EnterCriticalSection(static_cast<CRITICAL_SECTION*>(mutex_));
#else
  pthread_mutex_lock(static_cast<pthread_mutex_t*>(mutex_));
#endif

  uint8_t* buf;
  if (!free_list_.empty()) {
    buf = free_list_.back();
    free_list_.pop_back();
  } else {
    buf = static_cast<uint8_t*>(std::malloc(buffer_size_));
  }

#if SMOL_PLATFORM_WINDOWS
  LeaveCriticalSection(static_cast<CRITICAL_SECTION*>(mutex_));
#else
  pthread_mutex_unlock(static_cast<pthread_mutex_t*>(mutex_));
#endif

  return buf;
}

void BufferPool::Release(uint8_t* buffer) {
  if (!buffer) return;

#if SMOL_PLATFORM_WINDOWS
  EnterCriticalSection(static_cast<CRITICAL_SECTION*>(mutex_));
#else
  pthread_mutex_lock(static_cast<pthread_mutex_t*>(mutex_));
#endif

  if (free_list_.size() < pool_size_) {
    free_list_.push_back(buffer);
  } else {
    std::free(buffer);
  }

#if SMOL_PLATFORM_WINDOWS
  LeaveCriticalSection(static_cast<CRITICAL_SECTION*>(mutex_));
#else
  pthread_mutex_unlock(static_cast<pthread_mutex_t*>(mutex_));
#endif
}

// ============================================================================
// SIMD Utilities Implementation (delegates to shared smol::simd)
// ============================================================================

namespace simd {

const char* FindChar(const char* str, size_t len, char c) {
  return smol::simd::FindChar(str, len, c);
}

bool EqualsIgnoreCase(const char* a, size_t a_len, const char* b, size_t b_len) {
  return smol::simd::EqualsIgnoreCase(a, a_len, b, b_len);
}

void ToLowerCopy(const char* src, char* dst, size_t len) {
  smol::simd::ToLowerCopy(src, dst, len);
}

void XorRepeat4(uint8_t* data, size_t len, uint32_t key) {
  smol::simd::XorRepeat4(data, len, key);
}

}  // namespace simd

}  // namespace http
}  // namespace smol
