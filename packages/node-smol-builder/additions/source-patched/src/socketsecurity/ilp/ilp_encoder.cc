// ============================================================================
// ilp_encoder.cc -- ILP line-protocol text encoder implementation
// ============================================================================
//
// WHAT THIS FILE DOES
//   Builds ILP (Influx Line Protocol) text lines in a pre-allocated byte
//   buffer.  Each public method (Table, Symbol, StringColumn, BoolColumn,
//   IntColumn, FloatColumn, TimestampColumn, At, AtNow) appends the
//   correctly-formatted text for one part of an ILP row.
//
//   An ILP row is built in order:
//     1. Table("trades")           => writes "trades"
//     2. Symbol("ticker", "AAPL")  => appends ",ticker=AAPL"
//     3. FloatColumn("price", 1.5) => appends " price=1.5"
//     4. At(timestamp)             => appends " <timestamp>\n"
//
// WHY IT EXISTS (C++ instead of pure JS)
//   String concatenation in JS creates many intermediate string objects
//   that the garbage collector must later clean up.  This encoder writes
//   directly into a reusable byte buffer (std::vector<char>) with zero
//   allocations per row.  It also uses SIMD (CPU-level parallelism) to
//   quickly scan strings for characters that need escaping, processing
//   16 bytes at a time instead of one.
//
// HOW JAVASCRIPT USES THIS
//   IlpEncoder is owned by IlpBinding::SenderState.  JS never touches it
//   directly -- every call goes through ilp_binding.cc methods which
//   forward to the encoder.
//
// ESCAPING RULES (per ILP specification)
//   - Table/column names: escape space, comma, equals with backslash.
//   - String values: escape backslash, double-quote, newline, carriage
//     return.
//   - Symbol (tag) values: escape space, comma, equals, newline,
//     carriage return.
//
// KEY C++ CONCEPTS USED HERE
//   std::vector<char> buffer_
//     -- A growable byte array.  EnsureCapacity() doubles its size when
//        more space is needed, up to max_size_.
//
//   SIMD (SSE2 intrinsics like _mm_set1_epi8, _mm_cmpeq_epi8)
//     -- CPU instructions that compare 16 bytes simultaneously to check
//        whether any character needs escaping.  If none do, the entire
//        string is copied in bulk (memcpy).  This is the "fast path."
//
//   overflow_ flag
//     -- Node.js is compiled with -fno-exceptions (C++ throw is
//        forbidden).  When the buffer would exceed max_size_, this flag
//        is set instead, and all subsequent writes become no-ops until
//        the binding checks HasOverflowed() before flush.
// ============================================================================

#include "socketsecurity/ilp/ilp_encoder.h"
#include "socketsecurity/simd/simd.h"
#include <chrono>
#include <cstdio>
#include <cstring>

// SIMD-accelerated helpers for ILP encoding
namespace {

// Check if a name string needs escaping (space, comma, equals)
// Uses SIMD for fast scanning of 16+ byte strings
inline bool NeedsNameEscaping(const char* s, size_t len) {
#if SMOL_HAS_SSE2
  if (len >= 16) {
    __m128i space = _mm_set1_epi8(' ');
    __m128i comma = _mm_set1_epi8(',');
    __m128i equals = _mm_set1_epi8('=');
    size_t i = 0;

    for (; i + 16 <= len; i += 16) {
      __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(s + i));
      __m128i cmp = _mm_or_si128(
          _mm_or_si128(_mm_cmpeq_epi8(chunk, space), _mm_cmpeq_epi8(chunk, comma)),
          _mm_cmpeq_epi8(chunk, equals));
      if (_mm_movemask_epi8(cmp)) return true;
    }

    // Scalar remainder
    for (; i < len; i++) {
      char c = s[i];
      if (c == ' ' || c == ',' || c == '=') return true;
    }
    return false;
  }
#endif
  // Scalar fallback
  for (size_t i = 0; i < len; i++) {
    char c = s[i];
    if (c == ' ' || c == ',' || c == '=') return true;
  }
  return false;
}

// Check if a string value needs escaping (backslash, quote, newline, carriage return)
inline bool NeedsStringEscaping(const char* s, size_t len) {
#if SMOL_HAS_SSE2
  if (len >= 16) {
    __m128i backslash = _mm_set1_epi8('\\');
    __m128i quote = _mm_set1_epi8('"');
    __m128i newline = _mm_set1_epi8('\n');
    __m128i cr = _mm_set1_epi8('\r');
    size_t i = 0;

    for (; i + 16 <= len; i += 16) {
      __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(s + i));
      __m128i cmp = _mm_or_si128(
          _mm_or_si128(_mm_cmpeq_epi8(chunk, backslash), _mm_cmpeq_epi8(chunk, quote)),
          _mm_or_si128(_mm_cmpeq_epi8(chunk, newline), _mm_cmpeq_epi8(chunk, cr)));
      if (_mm_movemask_epi8(cmp)) return true;
    }

    // Scalar remainder
    for (; i < len; i++) {
      char c = s[i];
      if (c == '\\' || c == '"' || c == '\n' || c == '\r') return true;
    }
    return false;
  }
#endif
  // Scalar fallback
  for (size_t i = 0; i < len; i++) {
    char c = s[i];
    if (c == '\\' || c == '"' || c == '\n' || c == '\r') return true;
  }
  return false;
}

// Check if a symbol value needs escaping (space, comma, equals, newline, carriage return)
// Uses SIMD for fast scanning of 16+ byte strings
inline bool NeedsSymbolEscaping(const char* s, size_t len) {
#if SMOL_HAS_SSE2
  if (len >= 16) {
    __m128i space = _mm_set1_epi8(' ');
    __m128i comma = _mm_set1_epi8(',');
    __m128i equals = _mm_set1_epi8('=');
    __m128i newline = _mm_set1_epi8('\n');
    __m128i cr = _mm_set1_epi8('\r');
    size_t i = 0;

    for (; i + 16 <= len; i += 16) {
      __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(s + i));
      __m128i cmp1 = _mm_or_si128(
          _mm_cmpeq_epi8(chunk, space), _mm_cmpeq_epi8(chunk, comma));
      __m128i cmp2 = _mm_or_si128(
          _mm_cmpeq_epi8(chunk, equals), _mm_cmpeq_epi8(chunk, newline));
      __m128i cmp = _mm_or_si128(
          _mm_or_si128(cmp1, cmp2), _mm_cmpeq_epi8(chunk, cr));
      if (_mm_movemask_epi8(cmp)) return true;
    }

    // Scalar remainder
    for (; i < len; i++) {
      char c = s[i];
      if (c == ' ' || c == ',' || c == '=' || c == '\n' || c == '\r') return true;
    }
    return false;
  }
#endif
  // Scalar fallback
  for (size_t i = 0; i < len; i++) {
    char c = s[i];
    if (c == ' ' || c == ',' || c == '=' || c == '\n' || c == '\r') return true;
  }
  return false;
}

// Fast integer to string conversion (optimized for ILP use case)
// Returns number of characters written
inline size_t FormatInt64Fast(int64_t value, char* buffer) {
  if (value == 0) {
    buffer[0] = '0';
    return 1;
  }

  char temp[21];
  int pos = 20;
  bool negative = value < 0;
  uint64_t v = negative ? -static_cast<uint64_t>(value) : static_cast<uint64_t>(value);

  while (v > 0) {
    temp[pos--] = '0' + (v % 10);
    v /= 10;
  }

  if (negative) {
    temp[pos--] = '-';
  }

  size_t len = 20 - pos;
  std::memcpy(buffer, temp + pos + 1, len);
  return len;
}

}  // namespace

namespace node {
namespace socketsecurity {
namespace ilp {

IlpEncoder::IlpEncoder(size_t init_size, size_t max_size)
    : buffer_(init_size),
      position_(0),
      max_size_(max_size),
      has_fields_(false),
      overflow_(false) {}

void IlpEncoder::EnsureCapacity(size_t additional) {
  size_t needed = position_ + additional;
  if (needed <= buffer_.size()) {
    return;
  }

  if (needed > max_size_) {
    // Set overflow flag instead of throwing (Node.js uses -fno-exceptions).
    overflow_ = true;
    return;
  }

  // Grow by doubling, capped at max_size_ (set at construction from user
  // config, which the binding caps at 256 MB). The early-return at line 216
  // already guarantees `needed <= max_size_`, so clamping `new_size` to
  // `max_size_` is always safe — the resized buffer fits the request.
  size_t new_size = buffer_.size() * 2;
  while (new_size < needed) {
    new_size *= 2;
  }
  if (new_size > max_size_) {
    new_size = max_size_;
  }
  buffer_.resize(new_size);
}

void IlpEncoder::WriteChar(char c) {
  EnsureCapacity(1);
  if (overflow_) return;
  buffer_[position_++] = c;
}

void IlpEncoder::WriteBytes(const char* data, size_t len) {
  if (len == 0) return;
  EnsureCapacity(len);
  if (overflow_) return;
  std::memcpy(buffer_.data() + position_, data, len);
  position_ += len;
}

void IlpEncoder::WriteEscapedName(const char* name, size_t len) {
  // SIMD fast path: if no escaping needed, bulk copy
  if (!NeedsNameEscaping(name, len)) {
    WriteBytes(name, len);
    return;
  }

  // Slow path: Table/column names need escaping (space, comma, equals)
  // Pre-allocate worst case (every char escaped) to avoid per-byte capacity checks.
  EnsureCapacity(len * 2);
  if (overflow_) return;
  char* dst = buffer_.data() + position_;
  size_t written = 0;
  for (size_t i = 0; i < len; ++i) {
    char c = name[i];
    if (c == ' ' || c == ',' || c == '=') {
      dst[written++] = '\\';
    }
    dst[written++] = c;
  }
  position_ += written;
}

void IlpEncoder::WriteEscapedString(const char* str, size_t len) {
  // SIMD fast path: if no escaping needed, bulk copy
  if (!NeedsStringEscaping(str, len)) {
    WriteBytes(str, len);
    return;
  }

  // Slow path: String values need escaping (backslash, double quote, newline)
  // Pre-allocate worst case (every char escaped) to avoid per-byte capacity checks.
  EnsureCapacity(len * 2);
  if (overflow_) return;
  char* dst = buffer_.data() + position_;
  size_t written = 0;
  for (size_t i = 0; i < len; ++i) {
    char c = str[i];
    if (c == '\\' || c == '"') {
      dst[written++] = '\\';
      dst[written++] = c;
    } else if (c == '\n') {
      dst[written++] = '\\';
      dst[written++] = 'n';
    } else if (c == '\r') {
      dst[written++] = '\\';
      dst[written++] = 'r';
    } else {
      dst[written++] = c;
    }
  }
  position_ += written;
}

void IlpEncoder::WriteEscapedSymbol(const char* str, size_t len) {
  // SIMD fast path: if no escaping needed, bulk copy
  if (!NeedsSymbolEscaping(str, len)) {
    WriteBytes(str, len);
    return;
  }

  // Slow path: Symbol values need escaping (space, comma, equals, newline, cr)
  // Pre-allocate worst case (every char escaped) to avoid per-byte capacity checks.
  EnsureCapacity(len * 2);
  if (overflow_) return;
  char* dst = buffer_.data() + position_;
  size_t written = 0;
  for (size_t i = 0; i < len; ++i) {
    char c = str[i];
    if (c == ' ' || c == ',' || c == '=' || c == '\n' || c == '\r') {
      dst[written++] = '\\';
      if (c == '\n') {
        dst[written++] = 'n';
      } else if (c == '\r') {
        dst[written++] = 'r';
      } else {
        dst[written++] = c;
      }
    } else {
      dst[written++] = c;
    }
  }
  position_ += written;
}

void IlpEncoder::WriteInt(int64_t value) {
  char buf[32];
  size_t len = FormatInt64Fast(value, buf);
  WriteBytes(buf, len);
}

void IlpEncoder::WriteDouble(double value) {
  char buf[32];
  int len = std::snprintf(buf, sizeof(buf), "%.15g", value);
  WriteBytes(buf, len);
}

int64_t IlpEncoder::ConvertToNanos(int64_t value, TimestampUnit unit) const {
  int64_t multiplier;
  switch (unit) {
    case TimestampUnit::kNanoseconds:
      return value;
    case TimestampUnit::kMicroseconds:
      multiplier = 1000LL;
      break;
    case TimestampUnit::kMilliseconds:
      multiplier = 1000000LL;
      break;
    case TimestampUnit::kSeconds:
      multiplier = 1000000000LL;
      break;
    default:
      return value;
  }
  if (value > INT64_MAX / multiplier || value < INT64_MIN / multiplier) {
    overflow_ = true;
    return 0;
  }
  return value * multiplier;
}

void IlpEncoder::Table(const char* name, size_t len) {
  WriteEscapedName(name, len);
  has_fields_ = false;
}

void IlpEncoder::Symbol(const char* name, size_t name_len,
                        const char* value, size_t value_len) {
  WriteChar(',');
  WriteEscapedName(name, name_len);
  WriteChar('=');
  WriteEscapedSymbol(value, value_len);
}

void IlpEncoder::StringColumn(const char* name, size_t name_len,
                              const char* value, size_t value_len) {
  WriteChar(has_fields_ ? ',' : ' ');
  has_fields_ = true;
  WriteEscapedName(name, name_len);
  WriteChar('=');
  WriteChar('"');
  WriteEscapedString(value, value_len);
  WriteChar('"');
}

void IlpEncoder::BoolColumn(const char* name, size_t name_len, bool value) {
  WriteChar(has_fields_ ? ',' : ' ');
  has_fields_ = true;
  WriteEscapedName(name, name_len);
  WriteChar('=');
  WriteChar(value ? 't' : 'f');
}

void IlpEncoder::IntColumn(const char* name, size_t name_len, int64_t value) {
  WriteChar(has_fields_ ? ',' : ' ');
  has_fields_ = true;
  WriteEscapedName(name, name_len);
  WriteChar('=');
  WriteInt(value);
  WriteChar('i');
}

void IlpEncoder::FloatColumn(const char* name, size_t name_len, double value) {
  WriteChar(has_fields_ ? ',' : ' ');
  has_fields_ = true;
  WriteEscapedName(name, name_len);
  WriteChar('=');
  WriteDouble(value);
}

void IlpEncoder::TimestampColumn(const char* name, size_t name_len,
                                 int64_t value, TimestampUnit unit) {
  WriteChar(has_fields_ ? ',' : ' ');
  has_fields_ = true;
  WriteEscapedName(name, name_len);
  WriteChar('=');
  WriteInt(ConvertToNanos(value, unit));
  WriteChar('t');
}

void IlpEncoder::At(int64_t timestamp, TimestampUnit unit) {
  WriteChar(' ');
  WriteInt(ConvertToNanos(timestamp, unit));
  WriteChar('\n');
  has_fields_ = false;
}

void IlpEncoder::AtNow() {
  WriteChar('\n');
  has_fields_ = false;
}

}  // namespace ilp
}  // namespace socketsecurity
}  // namespace node
