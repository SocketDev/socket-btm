// Suppress V8-internal deprecation warning for Object::GetIsolate()
// called from v8-object.h static method (not our code).
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

// Fast HTTP response writer — direct UV stream writes.
//
// This is the performance-critical path for node:smol-http. Instead of
// calling back into JavaScript (socket.write), we write directly to the
// UV stream handle via uv_try_write(). This eliminates:
//
//   - V8 property lookups for "write", "cork", "uncork" (3 per response)
//   - Buffer::Copy heap allocations for headers and body (2 per response)
//   - JavaScript function calls for cork/write/uncork (4 per response)
//   - Node.js Writable stream state machine overhead
//
// The approach mirrors uWebSockets' architecture:
//   1. Build headers + body into a stack buffer (like uWS's cork buffer)
//   2. Call uv_try_write() (like uWS's direct send() syscall)
//   3. If uv_try_write can't send everything, fall back to JS path

#include "socketsecurity/http/http_fast_response.h"
#include "env-inl.h"
#include "node_internals.h"
#include "stream_base-inl.h"
#include "stream_wrap.h"
#include "util-inl.h"
#include <cstdio>
#include <cstring>

namespace node {
namespace socketsecurity {
namespace http_perf {

using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::Object;
using v8::String;
using v8::Value;

// ============================================================================
// Pre-computed response components (zero allocation at runtime)
// ============================================================================

// Status lines — pre-formatted with trailing \r\n
struct StatusLine {
  const char* text;
  size_t length;
};

static constexpr StatusLine kStatusLines[] = {
  {nullptr, 0},  // placeholder for index 0
};

// Auto-compute status line length at compile time — no manual counting.
#define STATUS_LINE_ENTRY(code, text) \
  case code: { \
    static constexpr char kLine[] = "HTTP/1.1 " #code " " text "\r\n"; \
    *out_len = sizeof(kLine) - 1; \
    return kLine; \
  }

static const char* GetStatusLine(int code, size_t* out_len) {
  switch (code) {
    STATUS_LINE_ENTRY(200, "OK")
    STATUS_LINE_ENTRY(201, "Created")
    STATUS_LINE_ENTRY(204, "No Content")
    STATUS_LINE_ENTRY(301, "Moved Permanently")
    STATUS_LINE_ENTRY(304, "Not Modified")
    STATUS_LINE_ENTRY(400, "Bad Request")
    STATUS_LINE_ENTRY(401, "Unauthorized")
    STATUS_LINE_ENTRY(403, "Forbidden")
    STATUS_LINE_ENTRY(404, "Not Found")
    STATUS_LINE_ENTRY(500, "Internal Server Error")
    default: *out_len = 0; return nullptr;
  }
}

#undef STATUS_LINE_ENTRY

// Content-Type headers — pre-formatted with Connection: keep-alive
static constexpr const char kJsonHeaders[] =
    "Content-Type: application/json\r\n"
    "Connection: keep-alive\r\n"
    "Content-Length: ";
static constexpr size_t kJsonHeadersLen = sizeof(kJsonHeaders) - 1;

static constexpr const char kTextHeaders[] =
    "Content-Type: text/plain\r\n"
    "Connection: keep-alive\r\n"
    "Content-Length: ";
static constexpr size_t kTextHeadersLen = sizeof(kTextHeaders) - 1;

static constexpr const char kBinaryHeaderPrefix[] =
    "Content-Type: ";
static constexpr size_t kBinaryHeaderPrefixLen = sizeof(kBinaryHeaderPrefix) - 1;

static constexpr const char kBinaryHeaderSuffix[] =
    "\r\nConnection: keep-alive\r\n"
    "Content-Length: ";
static constexpr size_t kBinaryHeaderSuffixLen = sizeof(kBinaryHeaderSuffix) - 1;

static constexpr const char kHeaderEnd[] = "\r\n\r\n";
static constexpr size_t kHeaderEndLen = 4;

// Pre-computed 304 response (complete, no body)
static constexpr const char k304Response[] =
    "HTTP/1.1 304 Not Modified\r\n"
    "Connection: keep-alive\r\n"
    "\r\n";
static constexpr size_t k304ResponseLen = sizeof(k304Response) - 1;


// ============================================================================
// UV Stream Access — get uv_stream_t from JS socket object
// ============================================================================

uv_stream_t* FastResponse::GetUvStream(
    Environment* env,
    Local<Object> socket) {
  Isolate* isolate = env->isolate();

  // Get socket._handle (the TCP wrap object)
  Local<Value> handle_val;
  if (!socket->Get(env->context(),
        FIXED_ONE_BYTE_STRING(isolate, "_handle"))
        .ToLocal(&handle_val) ||
      !handle_val->IsObject()) {
    return nullptr;
  }

  Local<Object> handle = handle_val.As<Object>();

  // The TCP wrap has internal fields — check it has enough
  if (handle->InternalFieldCount() <= StreamBase::kStreamBaseField) {
    return nullptr;
  }

  // Get the StreamBase from the handle's internal field, then cast to
  // LibuvStreamWrap to access the uv_stream_t*.
  StreamBase* stream_base = StreamBase::FromObject(handle);
  if (stream_base == nullptr) {
    return nullptr;
  }

  // LibuvStreamWrap is the concrete class for TCP/pipe sockets in Node.js.
  // It exposes stream() -> uv_stream_t* which StreamBase does not.
  LibuvStreamWrap* wrap = static_cast<LibuvStreamWrap*>(stream_base);
  return wrap->stream();
}


// ============================================================================
// Direct Write — uv_try_write (single buffer)
// ============================================================================

bool FastResponse::TryWrite(
    uv_stream_t* stream, const char* data, size_t length) {
  if (stream == nullptr || length == 0) return false;

  uv_buf_t buf = uv_buf_init(const_cast<char*>(data), length);
  int written = uv_try_write(stream, &buf, 1);

  // uv_try_write returns number of bytes written, or negative error.
  // We need ALL bytes written for success (no partial writes).
  return written == static_cast<int>(length);
}


// ============================================================================
// Direct Write — uv_try_write (two buffers via writev)
// ============================================================================

bool FastResponse::TryWrite2(
    uv_stream_t* stream,
    const char* data1, size_t len1,
    const char* data2, size_t len2) {
  if (stream == nullptr) return false;

  // Always use writev — the kernel coalesces the 2 iovecs in the socket
  // buffer. This avoids the memcpy overhead of combining into a single
  // buffer, and writev with 2 bufs is essentially free.
  uv_buf_t bufs[2] = {
    uv_buf_init(const_cast<char*>(data1), len1),
    uv_buf_init(const_cast<char*>(data2), len2),
  };
  int written = uv_try_write(stream, bufs, 2);
  return written == static_cast<int>(len1 + len2);
}


// ============================================================================
// Build HTTP response headers into a buffer (zero heap allocation)
// ============================================================================

size_t FastResponse::BuildHeaders(
    char* buffer,
    size_t buffer_size,
    int status_code,
    const char* content_type,
    size_t content_type_len,
    size_t content_length) {
  size_t offset = 0;

  // Status line
  size_t status_len;
  const char* status_line = GetStatusLine(status_code, &status_len);
  if (status_line == nullptr) return 0;
  if (offset + status_len > buffer_size) return 0;
  memcpy(buffer + offset, status_line, status_len);
  offset += status_len;

  // Content-Type + Connection + Content-Length prefix
  // Use pre-computed headers for common types
  if (content_type_len == 16 &&
      memcmp(content_type, "application/json", 16) == 0) {
    if (offset + kJsonHeadersLen > buffer_size) return 0;
    memcpy(buffer + offset, kJsonHeaders, kJsonHeadersLen);
    offset += kJsonHeadersLen;
  } else if (content_type_len == 10 &&
             memcmp(content_type, "text/plain", 10) == 0) {
    if (offset + kTextHeadersLen > buffer_size) return 0;
    memcpy(buffer + offset, kTextHeaders, kTextHeadersLen);
    offset += kTextHeadersLen;
  } else {
    // Generic content-type
    size_t needed = kBinaryHeaderPrefixLen + content_type_len +
                    kBinaryHeaderSuffixLen;
    if (offset + needed > buffer_size) return 0;
    memcpy(buffer + offset, kBinaryHeaderPrefix, kBinaryHeaderPrefixLen);
    offset += kBinaryHeaderPrefixLen;
    memcpy(buffer + offset, content_type, content_type_len);
    offset += content_type_len;
    memcpy(buffer + offset, kBinaryHeaderSuffix, kBinaryHeaderSuffixLen);
    offset += kBinaryHeaderSuffixLen;
  }

  // Content-Length value + \r\n\r\n
  // Hand-rolled itoa — avoids snprintf overhead (no format parsing, no locale).
  char cl_digits[20];
  int cl_len = 0;
  {
    size_t val = content_length;
    if (val == 0) {
      cl_digits[0] = '0';
      cl_len = 1;
    } else {
      // Write digits in reverse, then flip
      char tmp[20];
      int n = 0;
      while (val > 0) {
        tmp[n++] = '0' + (val % 10);
        val /= 10;
      }
      cl_len = n;
      for (int i = 0; i < n; i++) {
        cl_digits[i] = tmp[n - 1 - i];
      }
    }
  }
  if (offset + cl_len + kHeaderEndLen > buffer_size) return 0;
  memcpy(buffer + offset, cl_digits, cl_len);
  offset += cl_len;
  memcpy(buffer + offset, kHeaderEnd, kHeaderEndLen);
  offset += kHeaderEndLen;

  return offset;
}


// ============================================================================
// Public API — WriteJson
// ============================================================================

bool FastResponse::WriteJson(
    Environment* env,
    Local<Object> socket,
    int status_code,
    const char* json_data,
    size_t json_length) {

  // Build headers
  char header_buf[512];
  size_t header_len = BuildHeaders(
    header_buf, sizeof(header_buf),
    status_code, "application/json", 16, json_length);
  if (header_len == 0) return false;

  // Get UV stream
  uv_stream_t* stream = GetUvStream(env, socket);
  if (stream == nullptr) return false;

  // Write headers + body in single operation
  return TryWrite2(stream, header_buf, header_len, json_data, json_length);
}


// ============================================================================
// Public API — WriteText
// ============================================================================

bool FastResponse::WriteText(
    Environment* env,
    Local<Object> socket,
    int status_code,
    const char* text_data,
    size_t text_length) {

  // Build headers
  char header_buf[512];
  size_t header_len = BuildHeaders(
    header_buf, sizeof(header_buf),
    status_code, "text/plain", 10, text_length);
  if (header_len == 0) return false;

  // Get UV stream
  uv_stream_t* stream = GetUvStream(env, socket);
  if (stream == nullptr) return false;

  // Write headers + body in single operation
  return TryWrite2(stream, header_buf, header_len, text_data, text_length);
}


// ============================================================================
// Public API — WriteBinary
// ============================================================================

bool FastResponse::WriteBinary(
    Environment* env,
    Local<Object> socket,
    int status_code,
    const uint8_t* data,
    size_t length,
    const char* content_type) {

  size_t ct_len = strlen(content_type);

  // Build headers
  char header_buf[512];
  size_t header_len = BuildHeaders(
    header_buf, sizeof(header_buf),
    status_code, content_type, ct_len, length);
  if (header_len == 0) return false;

  // Get UV stream
  uv_stream_t* stream = GetUvStream(env, socket);
  if (stream == nullptr) return false;

  // Write headers + body in single operation
  return TryWrite2(stream,
    header_buf, header_len,
    reinterpret_cast<const char*>(data), length);
}


// ============================================================================
// Public API — WriteNotModified (304)
// ============================================================================

bool FastResponse::WriteNotModified(
    Environment* env,
    Local<Object> socket) {
  uv_stream_t* stream = GetUvStream(env, socket);
  if (stream == nullptr) return false;
  return TryWrite(stream, k304Response, k304ResponseLen);
}


// ============================================================================
// Public API — WritePrecomputed (for static response buffers)
// ============================================================================

bool FastResponse::WritePrecomputed(
    Environment* env,
    Local<Object> socket,
    const char* data,
    size_t length) {
  uv_stream_t* stream = GetUvStream(env, socket);
  if (stream == nullptr) return false;
  return TryWrite(stream, data, length);
}


}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node

#pragma GCC diagnostic pop
