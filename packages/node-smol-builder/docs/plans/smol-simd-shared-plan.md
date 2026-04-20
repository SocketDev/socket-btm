# Shared SIMD Infrastructure Plan

## Overview

Extract SIMD utilities from `smol_http_binding.cc` into a shared header that all smol-* C++ modules can use. Then add C++ bindings to smol-ilp and smol-vfs for hot path acceleration.

## Phase 1: Create Shared SIMD Header

### `smol_simd.h` - Cross-Platform SIMD Utilities

```cpp
#ifndef SRC_SMOL_SIMD_H_
#define SRC_SMOL_SIMD_H_

#include <cstdint>
#include <cstddef>
#include <cstring>

// ============================================================================
// PLATFORM DETECTION
// ============================================================================

#if defined(_WIN32) || defined(_WIN64)
  #define SMOL_PLATFORM_WINDOWS 1
#elif defined(__APPLE__)
  #define SMOL_PLATFORM_MACOS 1
#elif defined(__linux__)
  #define SMOL_PLATFORM_LINUX 1
#elif defined(__FreeBSD__) || defined(__OpenBSD__) || defined(__NetBSD__)
  #define SMOL_PLATFORM_BSD 1
#endif

// ============================================================================
// ARCHITECTURE DETECTION
// ============================================================================

#if defined(_M_X64) || defined(__x86_64__)
  #define SMOL_ARCH_X64 1
#elif defined(_M_IX86) || defined(__i386__)
  #define SMOL_ARCH_X86 1
#endif

#if defined(__aarch64__) || defined(_M_ARM64)
  #define SMOL_ARCH_ARM64 1
#elif defined(__arm__) || defined(_M_ARM)
  #define SMOL_ARCH_ARM32 1
#endif

// ============================================================================
// SIMD FEATURE DETECTION
// ============================================================================

#if SMOL_ARCH_X64 || SMOL_ARCH_X86
  #define SMOL_HAS_SSE2 1
  #include <emmintrin.h>  // SSE2

  #if defined(__SSE4_2__) || defined(__AVX2__)
    #define SMOL_HAS_SSE42 1
    #include <nmmintrin.h>  // SSE4.2
  #endif

  #if defined(__AVX2__)
    #define SMOL_COMPILE_AVX2 1
    #include <immintrin.h>  // AVX2
  #endif

  // Windows intrinsics
  #if SMOL_PLATFORM_WINDOWS
    #include <intrin.h>
  #else
    #include <cpuid.h>
  #endif
#endif

#if SMOL_ARCH_ARM64 || SMOL_ARCH_ARM32
  #define SMOL_HAS_NEON 1
  #include <arm_neon.h>
#endif

// ============================================================================
// COMPILER HINTS
// ============================================================================

#if defined(_MSC_VER)
  #define SMOL_FORCE_INLINE __forceinline
  #define SMOL_UNLIKELY(x) (x)
  #define SMOL_LIKELY(x) (x)
#else
  #define SMOL_FORCE_INLINE __attribute__((always_inline)) inline
  #define SMOL_UNLIKELY(x) __builtin_expect(!!(x), 0)
  #define SMOL_LIKELY(x) __builtin_expect(!!(x), 1)
#endif

// ============================================================================
// RUNTIME AVX2 DETECTION
// ============================================================================

namespace smol {
namespace simd {

// Global flag set at startup
extern bool g_has_avx2;

inline void Init() {
#if SMOL_ARCH_X64 || SMOL_ARCH_X86
  #if SMOL_PLATFORM_WINDOWS
    int cpuInfo[4];
    __cpuidex(cpuInfo, 7, 0);
    g_has_avx2 = (cpuInfo[1] & (1 << 5)) != 0;
  #else
    unsigned int eax, ebx, ecx, edx;
    if (__get_cpuid_count(7, 0, &eax, &ebx, &ecx, &edx)) {
      g_has_avx2 = (ebx & (1 << 5)) != 0;
    }
  #endif
#else
  g_has_avx2 = false;
#endif
}

// ============================================================================
// BIT MANIPULATION (Cross-Platform)
// ============================================================================

SMOL_FORCE_INLINE int CountTrailingZeros(uint32_t x) {
#if defined(_MSC_VER)
  unsigned long idx;
  _BitScanForward(&idx, x);
  return static_cast<int>(idx);
#else
  return __builtin_ctz(x);
#endif
}

SMOL_FORCE_INLINE int CountTrailingZeros64(uint64_t x) {
#if defined(_MSC_VER)
  unsigned long idx;
  _BitScanForward64(&idx, x);
  return static_cast<int>(idx);
#else
  return __builtin_ctzll(x);
#endif
}

// ============================================================================
// FIND CHARACTER
// ============================================================================

SMOL_FORCE_INLINE const char* FindCharScalar(const char* s, size_t len, char c) {
  for (size_t i = 0; i < len; i++) {
    if (s[i] == c) return s + i;
  }
  return nullptr;
}

#if SMOL_HAS_SSE2
SMOL_FORCE_INLINE const char* FindCharSSE2(const char* s, size_t len, char c) {
  __m128i needle = _mm_set1_epi8(c);
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(s + i));
    __m128i cmp = _mm_cmpeq_epi8(chunk, needle);
    int mask = _mm_movemask_epi8(cmp);
    if (mask) {
      return s + i + CountTrailingZeros(mask);
    }
  }

  for (; i < len; i++) {
    if (s[i] == c) return s + i;
  }
  return nullptr;
}
#endif

#if SMOL_COMPILE_AVX2
SMOL_FORCE_INLINE const char* FindCharAVX2(const char* s, size_t len, char c) {
  __m256i needle = _mm256_set1_epi8(c);
  size_t i = 0;

  for (; i + 32 <= len; i += 32) {
    __m256i chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(s + i));
    __m256i cmp = _mm256_cmpeq_epi8(chunk, needle);
    int mask = _mm256_movemask_epi8(cmp);
    if (mask) {
      return s + i + CountTrailingZeros(mask);
    }
  }

  return FindCharSSE2(s + i, len - i, c);
}
#endif

#if SMOL_HAS_NEON
SMOL_FORCE_INLINE const char* FindCharNEON(const char* s, size_t len, char c) {
  uint8x16_t needle = vdupq_n_u8(static_cast<uint8_t>(c));
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    uint8x16_t chunk = vld1q_u8(reinterpret_cast<const uint8_t*>(s + i));
    uint8x16_t cmp = vceqq_u8(chunk, needle);
    uint64x2_t cmp64 = vreinterpretq_u64_u8(cmp);
    uint64_t lo = vgetq_lane_u64(cmp64, 0);
    uint64_t hi = vgetq_lane_u64(cmp64, 1);
    if (lo) {
      return s + i + (CountTrailingZeros64(lo) >> 3);
    }
    if (hi) {
      return s + i + 8 + (CountTrailingZeros64(hi) >> 3);
    }
  }

  for (; i < len; i++) {
    if (s[i] == c) return s + i;
  }
  return nullptr;
}
#endif

inline const char* FindChar(const char* s, size_t len, char c) {
#if SMOL_COMPILE_AVX2
  if (g_has_avx2) return FindCharAVX2(s, len, c);
#endif
#if SMOL_HAS_SSE2
  return FindCharSSE2(s, len, c);
#elif SMOL_HAS_NEON
  return FindCharNEON(s, len, c);
#else
  return FindCharScalar(s, len, c);
#endif
}

// ============================================================================
// FIND ANY OF MULTIPLE CHARACTERS
// ============================================================================

#if SMOL_HAS_SSE2
SMOL_FORCE_INLINE size_t FindAnyOfSSE2(
    const char* s, size_t len, char c1, char c2, char c3 = 0, char c4 = 0) {
  __m128i n1 = _mm_set1_epi8(c1);
  __m128i n2 = _mm_set1_epi8(c2);
  __m128i n3 = _mm_set1_epi8(c3);
  __m128i n4 = _mm_set1_epi8(c4);
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(s + i));
    __m128i cmp = _mm_or_si128(
        _mm_or_si128(_mm_cmpeq_epi8(chunk, n1), _mm_cmpeq_epi8(chunk, n2)),
        _mm_or_si128(_mm_cmpeq_epi8(chunk, n3), _mm_cmpeq_epi8(chunk, n4)));
    int mask = _mm_movemask_epi8(cmp);
    if (mask) {
      return i + CountTrailingZeros(mask);
    }
  }

  for (; i < len; i++) {
    char ch = s[i];
    if (ch == c1 || ch == c2 || ch == c3 || ch == c4) return i;
  }
  return len;
}
#endif

inline size_t FindAnyOf(const char* s, size_t len, char c1, char c2, char c3 = 0, char c4 = 0) {
#if SMOL_HAS_SSE2
  return FindAnyOfSSE2(s, len, c1, c2, c3, c4);
#else
  for (size_t i = 0; i < len; i++) {
    char ch = s[i];
    if (ch == c1 || ch == c2 || ch == c3 || ch == c4) return i;
  }
  return len;
#endif
}

// ============================================================================
// TO LOWERCASE (In-Place)
// ============================================================================

#if SMOL_HAS_SSE2
SMOL_FORCE_INLINE void ToLowerSSE2(char* s, size_t len) {
  const __m128i upper_a = _mm_set1_epi8('A' - 1);
  const __m128i upper_z = _mm_set1_epi8('Z' + 1);
  const __m128i to_lower = _mm_set1_epi8(0x20);
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(s + i));
    __m128i gt_a = _mm_cmpgt_epi8(chunk, upper_a);
    __m128i lt_z = _mm_cmplt_epi8(chunk, upper_z);
    __m128i is_upper = _mm_and_si128(gt_a, lt_z);
    __m128i lower_mask = _mm_and_si128(is_upper, to_lower);
    chunk = _mm_or_si128(chunk, lower_mask);
    _mm_storeu_si128(reinterpret_cast<__m128i*>(s + i), chunk);
  }

  for (; i < len; i++) {
    if (s[i] >= 'A' && s[i] <= 'Z') s[i] += 0x20;
  }
}
#endif

#if SMOL_HAS_NEON
SMOL_FORCE_INLINE void ToLowerNEON(char* s, size_t len) {
  const uint8x16_t upper_a = vdupq_n_u8('A');
  const uint8x16_t upper_z = vdupq_n_u8('Z');
  const uint8x16_t to_lower = vdupq_n_u8(0x20);
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    uint8x16_t chunk = vld1q_u8(reinterpret_cast<const uint8_t*>(s + i));
    uint8x16_t ge_a = vcgeq_u8(chunk, upper_a);
    uint8x16_t le_z = vcleq_u8(chunk, upper_z);
    uint8x16_t is_upper = vandq_u8(ge_a, le_z);
    uint8x16_t lower_mask = vandq_u8(is_upper, to_lower);
    chunk = vorrq_u8(chunk, lower_mask);
    vst1q_u8(reinterpret_cast<uint8_t*>(s + i), chunk);
  }

  for (; i < len; i++) {
    if (s[i] >= 'A' && s[i] <= 'Z') s[i] += 0x20;
  }
}
#endif

inline void ToLower(char* s, size_t len) {
#if SMOL_HAS_SSE2
  ToLowerSSE2(s, len);
#elif SMOL_HAS_NEON
  ToLowerNEON(s, len);
#else
  for (size_t i = 0; i < len; i++) {
    if (s[i] >= 'A' && s[i] <= 'Z') s[i] += 0x20;
  }
#endif
}

// ============================================================================
// XOR REPEAT 4 (WebSocket Masking)
// ============================================================================

#if SMOL_COMPILE_AVX2
SMOL_FORCE_INLINE void XorRepeat4AVX2(uint8_t* data, size_t len, uint32_t key) {
  __m256i mask = _mm256_set1_epi32(static_cast<int32_t>(key));
  size_t i = 0;

  for (; i + 32 <= len; i += 32) {
    __m256i chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(data + i));
    chunk = _mm256_xor_si256(chunk, mask);
    _mm256_storeu_si256(reinterpret_cast<__m256i*>(data + i), chunk);
  }

  // SSE2 fallback for 16-31 bytes
  if (i + 16 <= len) {
    __m128i mask128 = _mm_set1_epi32(static_cast<int32_t>(key));
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(data + i));
    chunk = _mm_xor_si128(chunk, mask128);
    _mm_storeu_si128(reinterpret_cast<__m128i*>(data + i), chunk);
    i += 16;
  }

  // Scalar remainder
  const uint8_t* kb = reinterpret_cast<const uint8_t*>(&key);
  for (; i < len; i++) {
    data[i] ^= kb[i & 3];
  }
}
#endif

#if SMOL_HAS_SSE2
SMOL_FORCE_INLINE void XorRepeat4SSE2(uint8_t* data, size_t len, uint32_t key) {
  __m128i mask = _mm_set1_epi32(static_cast<int32_t>(key));
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(data + i));
    chunk = _mm_xor_si128(chunk, mask);
    _mm_storeu_si128(reinterpret_cast<__m128i*>(data + i), chunk);
  }

  const uint8_t* kb = reinterpret_cast<const uint8_t*>(&key);
  for (; i < len; i++) {
    data[i] ^= kb[i & 3];
  }
}
#endif

#if SMOL_HAS_NEON
SMOL_FORCE_INLINE void XorRepeat4NEON(uint8_t* data, size_t len, uint32_t key) {
  uint32x4_t mask = vdupq_n_u32(key);
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    uint8x16_t chunk = vld1q_u8(data + i);
    chunk = veorq_u8(chunk, vreinterpretq_u8_u32(mask));
    vst1q_u8(data + i, chunk);
  }

  const uint8_t* kb = reinterpret_cast<const uint8_t*>(&key);
  for (; i < len; i++) {
    data[i] ^= kb[i & 3];
  }
}
#endif

inline void XorRepeat4(uint8_t* data, size_t len, uint32_t key) {
#if SMOL_COMPILE_AVX2
  if (g_has_avx2) { XorRepeat4AVX2(data, len, key); return; }
#endif
#if SMOL_HAS_SSE2
  XorRepeat4SSE2(data, len, key);
#elif SMOL_HAS_NEON
  XorRepeat4NEON(data, len, key);
#else
  const uint8_t* kb = reinterpret_cast<const uint8_t*>(&key);
  for (size_t i = 0; i < len; i++) {
    data[i] ^= kb[i & 3];
  }
#endif
}

// ============================================================================
// CHECKSUM (Sum of bytes - for TAR headers)
// ============================================================================

#if SMOL_HAS_SSE2
SMOL_FORCE_INLINE uint32_t ChecksumSSE2(const uint8_t* data, size_t len) {
  __m128i sum = _mm_setzero_si128();
  __m128i zero = _mm_setzero_si128();
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(data + i));
    // Unpack to 16-bit and add
    __m128i lo = _mm_unpacklo_epi8(chunk, zero);
    __m128i hi = _mm_unpackhi_epi8(chunk, zero);
    sum = _mm_add_epi32(sum, _mm_unpacklo_epi16(lo, zero));
    sum = _mm_add_epi32(sum, _mm_unpackhi_epi16(lo, zero));
    sum = _mm_add_epi32(sum, _mm_unpacklo_epi16(hi, zero));
    sum = _mm_add_epi32(sum, _mm_unpackhi_epi16(hi, zero));
  }

  // Horizontal sum
  __m128i sum2 = _mm_shuffle_epi32(sum, _MM_SHUFFLE(2, 3, 0, 1));
  sum = _mm_add_epi32(sum, sum2);
  sum2 = _mm_shuffle_epi32(sum, _MM_SHUFFLE(1, 0, 3, 2));
  sum = _mm_add_epi32(sum, sum2);

  uint32_t result = _mm_cvtsi128_si32(sum);

  // Scalar remainder
  for (; i < len; i++) {
    result += data[i];
  }

  return result;
}
#endif

inline uint32_t Checksum(const uint8_t* data, size_t len) {
#if SMOL_HAS_SSE2
  return ChecksumSSE2(data, len);
#else
  uint32_t sum = 0;
  for (size_t i = 0; i < len; i++) {
    sum += data[i];
  }
  return sum;
#endif
}

// ============================================================================
// PARSE DIGITS (Fast integer parsing)
// ============================================================================

SMOL_FORCE_INLINE uint64_t ParseDigitsScalar(const char* s, size_t len) {
  uint64_t result = 0;
  for (size_t i = 0; i < len; i++) {
    result = result * 10 + (s[i] - '0');
  }
  return result;
}

inline uint64_t ParseDigits(const char* s, size_t len) {
  // For short strings, scalar is fast enough
  // SIMD only helps for very long digit strings (>8 digits)
  return ParseDigitsScalar(s, len);
}

// ============================================================================
// NEEDS ESCAPE (ILP protocol)
// ============================================================================

// Check if string needs escaping for ILP wire format
// Escape chars: space, comma, equals, backslash, newline, carriage return

#if SMOL_HAS_SSE2
SMOL_FORCE_INLINE bool NeedsEscapeSSE2(const char* s, size_t len) {
  __m128i space = _mm_set1_epi8(' ');
  __m128i comma = _mm_set1_epi8(',');
  __m128i equals = _mm_set1_epi8('=');
  __m128i backslash = _mm_set1_epi8('\\');
  __m128i newline = _mm_set1_epi8('\n');
  __m128i cr = _mm_set1_epi8('\r');
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(s + i));
    __m128i cmp = _mm_or_si128(
        _mm_or_si128(
            _mm_or_si128(_mm_cmpeq_epi8(chunk, space), _mm_cmpeq_epi8(chunk, comma)),
            _mm_or_si128(_mm_cmpeq_epi8(chunk, equals), _mm_cmpeq_epi8(chunk, backslash))),
        _mm_or_si128(_mm_cmpeq_epi8(chunk, newline), _mm_cmpeq_epi8(chunk, cr)));
    if (_mm_movemask_epi8(cmp)) return true;
  }

  for (; i < len; i++) {
    char c = s[i];
    if (c == ' ' || c == ',' || c == '=' || c == '\\' || c == '\n' || c == '\r') {
      return true;
    }
  }
  return false;
}
#endif

inline bool NeedsEscape(const char* s, size_t len) {
#if SMOL_HAS_SSE2
  return NeedsEscapeSSE2(s, len);
#else
  for (size_t i = 0; i < len; i++) {
    char c = s[i];
    if (c == ' ' || c == ',' || c == '=' || c == '\\' || c == '\n' || c == '\r') {
      return true;
    }
  }
  return false;
#endif
}

// ============================================================================
// ESCAPE STRING (ILP protocol)
// ============================================================================

// Returns number of bytes written
inline size_t EscapeString(const char* src, size_t src_len, char* dst) {
  size_t j = 0;
  for (size_t i = 0; i < src_len; i++) {
    char c = src[i];
    switch (c) {
      case ' ':  dst[j++] = '\\'; dst[j++] = ' '; break;
      case ',':  dst[j++] = '\\'; dst[j++] = ','; break;
      case '=':  dst[j++] = '\\'; dst[j++] = '='; break;
      case '\\': dst[j++] = '\\'; dst[j++] = '\\'; break;
      case '\n': dst[j++] = '\\'; dst[j++] = 'n'; break;
      case '\r': dst[j++] = '\\'; dst[j++] = 'r'; break;
      default:   dst[j++] = c; break;
    }
  }
  return j;
}

}  // namespace simd
}  // namespace smol

#endif  // SRC_SMOL_SIMD_H_
```

## Phase 2: smol-ilp C++ Bindings

### `smol_ilp_binding.h`

```cpp
#ifndef SRC_SMOL_ILP_BINDING_H_
#define SRC_SMOL_ILP_BINDING_H_

#include "smol_simd.h"
#include <string_view>

namespace smol {
namespace ilp {

// Pre-sized buffer for ILP line building
class LineBuffer {
 public:
  static constexpr size_t kInitialSize = 4096;
  static constexpr size_t kMaxSize = 16 * 1024 * 1024;  // 16MB

  LineBuffer();
  ~LineBuffer();

  // Table name (measurement)
  bool WriteTable(std::string_view name);

  // Tag (symbol) - indexed column
  bool WriteSymbol(std::string_view name, std::string_view value);

  // Field columns
  bool WriteFloat(std::string_view name, double value);
  bool WriteInt(std::string_view name, int64_t value);
  bool WriteString(std::string_view name, std::string_view value);
  bool WriteBool(std::string_view name, bool value);

  // Timestamp
  bool WriteTimestamp(int64_t nanos);
  bool WriteTimestampNow();

  // Finalize line
  bool EndLine();

  // Get buffer contents
  const char* data() const { return buffer_; }
  size_t size() const { return pos_; }

  // Reset for reuse
  void Clear() { pos_ = 0; }

 private:
  bool EnsureCapacity(size_t additional);
  bool WriteEscaped(std::string_view s);

  char* buffer_;
  size_t capacity_;
  size_t pos_;
  bool in_fields_;  // After first field?
};

// Fast double-to-string conversion (Grisu3 based)
size_t FormatDouble(double value, char* buffer);

// Fast int64-to-string conversion
size_t FormatInt64(int64_t value, char* buffer);

}  // namespace ilp
}  // namespace smol

#endif  // SRC_SMOL_ILP_BINDING_H_
```

### `smol_ilp_binding.cc`

```cpp
#include "smol_ilp_binding.h"
#include "smol_simd.h"
#include <cstdlib>
#include <cstring>
#include <cstdio>

namespace smol {
namespace ilp {

LineBuffer::LineBuffer()
    : buffer_(static_cast<char*>(std::malloc(kInitialSize))),
      capacity_(kInitialSize),
      pos_(0),
      in_fields_(false) {}

LineBuffer::~LineBuffer() {
  std::free(buffer_);
}

bool LineBuffer::EnsureCapacity(size_t additional) {
  if (pos_ + additional <= capacity_) return true;

  size_t new_capacity = capacity_ * 2;
  while (new_capacity < pos_ + additional && new_capacity <= kMaxSize) {
    new_capacity *= 2;
  }

  if (new_capacity > kMaxSize) return false;

  char* new_buffer = static_cast<char*>(std::realloc(buffer_, new_capacity));
  if (!new_buffer) return false;

  buffer_ = new_buffer;
  capacity_ = new_capacity;
  return true;
}

bool LineBuffer::WriteEscaped(std::string_view s) {
  // Fast path: no escaping needed
  if (!simd::NeedsEscape(s.data(), s.size())) {
    if (!EnsureCapacity(s.size())) return false;
    std::memcpy(buffer_ + pos_, s.data(), s.size());
    pos_ += s.size();
    return true;
  }

  // Slow path: escape special characters
  // Worst case: every char is escaped (2x size)
  if (!EnsureCapacity(s.size() * 2)) return false;
  pos_ += simd::EscapeString(s.data(), s.size(), buffer_ + pos_);
  return true;
}

bool LineBuffer::WriteTable(std::string_view name) {
  pos_ = 0;
  in_fields_ = false;
  return WriteEscaped(name);
}

bool LineBuffer::WriteSymbol(std::string_view name, std::string_view value) {
  if (!EnsureCapacity(1)) return false;
  buffer_[pos_++] = ',';

  if (!WriteEscaped(name)) return false;

  if (!EnsureCapacity(1)) return false;
  buffer_[pos_++] = '=';

  return WriteEscaped(value);
}

bool LineBuffer::WriteFloat(std::string_view name, double value) {
  if (!EnsureCapacity(1)) return false;
  buffer_[pos_++] = in_fields_ ? ',' : ' ';
  in_fields_ = true;

  if (!WriteEscaped(name)) return false;

  if (!EnsureCapacity(1 + 32)) return false;  // = + max double length
  buffer_[pos_++] = '=';

  pos_ += FormatDouble(value, buffer_ + pos_);
  return true;
}

bool LineBuffer::WriteInt(std::string_view name, int64_t value) {
  if (!EnsureCapacity(1)) return false;
  buffer_[pos_++] = in_fields_ ? ',' : ' ';
  in_fields_ = true;

  if (!WriteEscaped(name)) return false;

  if (!EnsureCapacity(1 + 21 + 1)) return false;  // = + max int64 + 'i'
  buffer_[pos_++] = '=';

  pos_ += FormatInt64(value, buffer_ + pos_);
  buffer_[pos_++] = 'i';  // Integer suffix for ILP
  return true;
}

bool LineBuffer::WriteString(std::string_view name, std::string_view value) {
  if (!EnsureCapacity(1)) return false;
  buffer_[pos_++] = in_fields_ ? ',' : ' ';
  in_fields_ = true;

  if (!WriteEscaped(name)) return false;

  if (!EnsureCapacity(2)) return false;
  buffer_[pos_++] = '=';
  buffer_[pos_++] = '"';

  // String values need different escaping (just backslash and quote)
  for (size_t i = 0; i < value.size(); i++) {
    char c = value[i];
    if (c == '\\' || c == '"') {
      if (!EnsureCapacity(2)) return false;
      buffer_[pos_++] = '\\';
    } else {
      if (!EnsureCapacity(1)) return false;
    }
    buffer_[pos_++] = c;
  }

  if (!EnsureCapacity(1)) return false;
  buffer_[pos_++] = '"';
  return true;
}

bool LineBuffer::WriteBool(std::string_view name, bool value) {
  if (!EnsureCapacity(1)) return false;
  buffer_[pos_++] = in_fields_ ? ',' : ' ';
  in_fields_ = true;

  if (!WriteEscaped(name)) return false;

  if (!EnsureCapacity(2)) return false;
  buffer_[pos_++] = '=';
  buffer_[pos_++] = value ? 't' : 'f';
  return true;
}

bool LineBuffer::WriteTimestamp(int64_t nanos) {
  if (!EnsureCapacity(1 + 20)) return false;
  buffer_[pos_++] = ' ';
  pos_ += FormatInt64(nanos, buffer_ + pos_);
  return true;
}

bool LineBuffer::WriteTimestampNow() {
  // Let server assign timestamp
  return true;
}

bool LineBuffer::EndLine() {
  if (!EnsureCapacity(1)) return false;
  buffer_[pos_++] = '\n';
  in_fields_ = false;
  return true;
}

// Fast double formatting (simplified - use Grisu3 for production)
size_t FormatDouble(double value, char* buffer) {
  int n = std::snprintf(buffer, 32, "%.15g", value);
  return n > 0 ? n : 0;
}

// Fast int64 formatting
size_t FormatInt64(int64_t value, char* buffer) {
  if (value == 0) {
    buffer[0] = '0';
    return 1;
  }

  char temp[21];
  int pos = 20;
  bool negative = value < 0;
  uint64_t v = negative ? -static_cast<uint64_t>(value) : value;

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

}  // namespace ilp
}  // namespace smol
```

### V8 Binding: `smol_ilp_v8_binding.cc`

```cpp
#include "smol_ilp_binding.h"
#include "env-inl.h"
#include "node_internals.h"
#include "v8.h"

namespace smol {
namespace ilp {

using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

// Check if string needs escaping
void NeedsEscape(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().Set(false);
    return;
  }

  v8::String::Utf8Value str(isolate, args[0]);
  bool result = simd::NeedsEscape(*str, str.length());
  args.GetReturnValue().Set(result);
}

// Escape string for ILP
void EscapeString(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().SetUndefined();
    return;
  }

  v8::String::Utf8Value str(isolate, args[0]);
  size_t len = str.length();

  // Fast path: no escaping needed
  if (!simd::NeedsEscape(*str, len)) {
    args.GetReturnValue().Set(args[0]);
    return;
  }

  // Allocate output buffer (worst case: 2x size)
  char* output = new char[len * 2];
  size_t out_len = simd::EscapeString(*str, len, output);

  Local<String> result = String::NewFromUtf8(
      isolate, output, v8::NewStringType::kNormal, out_len).ToLocalChecked();

  delete[] output;
  args.GetReturnValue().Set(result);
}

// Format double for ILP
void FormatDouble(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1 || !args[0]->IsNumber()) {
    args.GetReturnValue().SetUndefined();
    return;
  }

  double value = args[0].As<v8::Number>()->Value();
  char buffer[32];
  size_t len = smol::ilp::FormatDouble(value, buffer);

  args.GetReturnValue().Set(
      String::NewFromUtf8(isolate, buffer, v8::NewStringType::kNormal, len)
          .ToLocalChecked());
}

// Format int64 for ILP
void FormatInt64(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1) {
    args.GetReturnValue().SetUndefined();
    return;
  }

  int64_t value;
  if (args[0]->IsBigInt()) {
    value = args[0].As<v8::BigInt>()->Int64Value();
  } else if (args[0]->IsNumber()) {
    value = static_cast<int64_t>(args[0].As<v8::Number>()->Value());
  } else {
    args.GetReturnValue().SetUndefined();
    return;
  }

  char buffer[21];
  size_t len = smol::ilp::FormatInt64(value, buffer);

  args.GetReturnValue().Set(
      String::NewFromUtf8(isolate, buffer, v8::NewStringType::kNormal, len)
          .ToLocalChecked());
}

void Initialize(Local<Object> target,
                Local<Value> unused,
                Local<Context> context,
                void* priv) {
  node::Environment* env = node::Environment::GetCurrent(context);

  // Initialize SIMD detection
  simd::Init();

  env->SetMethod(target, "needsEscape", NeedsEscape);
  env->SetMethod(target, "escapeString", EscapeString);
  env->SetMethod(target, "formatDouble", FormatDouble);
  env->SetMethod(target, "formatInt64", FormatInt64);
}

NODE_MODULE_CONTEXT_AWARE_INTERNAL(smol_ilp, Initialize)

}  // namespace ilp
}  // namespace smol
```

## Phase 3: smol-vfs C++ Bindings

### `smol_vfs_binding.h`

```cpp
#ifndef SRC_SMOL_VFS_BINDING_H_
#define SRC_SMOL_VFS_BINDING_H_

#include "smol_simd.h"
#include <string_view>

namespace smol {
namespace vfs {

// TAR header structure (512 bytes)
struct TarHeader {
  char name[100];
  char mode[8];
  char uid[8];
  char gid[8];
  char size[12];
  char mtime[12];
  char checksum[8];
  char typeflag;
  char linkname[100];
  char magic[6];
  char version[2];
  char uname[32];
  char gname[32];
  char devmajor[8];
  char devminor[8];
  char prefix[155];
  char padding[12];
};

static_assert(sizeof(TarHeader) == 512, "TarHeader must be 512 bytes");

// Parsed TAR entry
struct TarEntry {
  std::string_view name;
  uint64_t size;
  uint64_t mtime;
  uint32_t mode;
  char type;  // '0'=file, '5'=dir, etc.
  bool valid;
};

// Parse TAR header
TarEntry ParseTarHeader(const uint8_t* header);

// Calculate TAR checksum (SIMD accelerated)
uint32_t CalculateTarChecksum(const uint8_t* header);

// Verify TAR checksum
bool VerifyTarChecksum(const uint8_t* header);

// Parse octal string (SIMD for validation)
uint64_t ParseOctal(const char* str, size_t len);

}  // namespace vfs
}  // namespace smol

#endif  // SRC_SMOL_VFS_BINDING_H_
```

### `smol_vfs_binding.cc`

```cpp
#include "smol_vfs_binding.h"
#include <cstring>

namespace smol {
namespace vfs {

uint64_t ParseOctal(const char* str, size_t len) {
  uint64_t result = 0;

  // Skip leading spaces
  while (len > 0 && *str == ' ') {
    str++;
    len--;
  }

  // Parse octal digits
  while (len > 0) {
    char c = *str;
    if (c < '0' || c > '7') break;
    result = (result << 3) | (c - '0');
    str++;
    len--;
  }

  return result;
}

uint32_t CalculateTarChecksum(const uint8_t* header) {
  // TAR checksum: sum of all 512 bytes, with checksum field treated as spaces
  uint32_t sum = 0;

  // Use SIMD for first 148 bytes (before checksum)
  sum += simd::Checksum(header, 148);

  // Add 8 spaces for checksum field
  sum += 8 * ' ';

  // Use SIMD for remaining 356 bytes (after checksum)
  sum += simd::Checksum(header + 156, 356);

  return sum;
}

bool VerifyTarChecksum(const uint8_t* header) {
  const TarHeader* h = reinterpret_cast<const TarHeader*>(header);

  // Parse stored checksum
  uint64_t stored = ParseOctal(h->checksum, 8);

  // Calculate actual checksum
  uint32_t calculated = CalculateTarChecksum(header);

  return stored == calculated;
}

TarEntry ParseTarHeader(const uint8_t* header) {
  TarEntry entry = {};

  // Verify checksum first
  if (!VerifyTarChecksum(header)) {
    entry.valid = false;
    return entry;
  }

  const TarHeader* h = reinterpret_cast<const TarHeader*>(header);

  // Check for end-of-archive (512 zero bytes)
  bool all_zero = true;
  for (size_t i = 0; i < 512 && all_zero; i++) {
    if (header[i] != 0) all_zero = false;
  }
  if (all_zero) {
    entry.valid = false;
    return entry;
  }

  // Parse name (may be prefix + '/' + name for long paths)
  if (h->prefix[0] != '\0') {
    // Handle prefix in caller
  }

  // Find name length (null-terminated or 100 chars)
  size_t name_len = 0;
  while (name_len < 100 && h->name[name_len] != '\0') {
    name_len++;
  }
  entry.name = std::string_view(h->name, name_len);

  // Parse size
  entry.size = ParseOctal(h->size, 12);

  // Parse mtime
  entry.mtime = ParseOctal(h->mtime, 12);

  // Parse mode
  entry.mode = static_cast<uint32_t>(ParseOctal(h->mode, 8));

  // Type flag
  entry.type = h->typeflag ? h->typeflag : '0';

  entry.valid = true;
  return entry;
}

}  // namespace vfs
}  // namespace smol
```

## Build Configuration

### `smol_simd.gypi` (shared)

```python
{
  'targets': [
    {
      'target_name': 'smol_simd',
      'type': 'static_library',
      'sources': [
        'smol_simd.cc',  # Just contains: bool smol::simd::g_has_avx2 = false;
      ],
      'include_dirs': [
        '.',
        '<(node_root_dir)/src',
      ],
      'conditions': [
        ['OS=="win"', {
          'msvs_settings': {
            'VCCLCompilerTool': {
              'AdditionalOptions': ['/std:c++17'],
              'EnableEnhancedInstructionSet': '2',
            },
          },
        }],
        ['OS=="mac"', {
          'xcode_settings': {
            'CLANG_CXX_LANGUAGE_STANDARD': 'c++17',
          },
          'conditions': [
            ['target_arch=="x64"', {
              'xcode_settings': {
                'OTHER_CPLUSPLUSFLAGS': ['-msse4.2'],
              },
            }],
            ['target_arch=="arm64"', {
              'xcode_settings': {
                'OTHER_CPLUSPLUSFLAGS': ['-march=armv8-a+simd'],
              },
            }],
          ],
        }],
        ['OS=="linux"', {
          'cflags_cc': ['-std=c++17'],
          'conditions': [
            ['target_arch=="x64"', {
              'cflags_cc': ['-msse2', '-msse4.2'],
            }],
            ['target_arch=="arm64"', {
              'cflags_cc': ['-march=armv8-a+simd'],
            }],
          ],
        }],
      ],
    },
  ],
}
```

## Performance Targets

| Module | Operation | Before | After | Speedup |
|--------|-----------|--------|-------|---------|
| **smol-ilp** | NeedsEscape check | ~200ns | ~15ns | **13x** |
| **smol-ilp** | EscapeString | ~500ns | ~50ns | **10x** |
| **smol-ilp** | FormatDouble | ~300ns | ~40ns | **7x** |
| **smol-vfs** | TAR checksum | ~400ns | ~30ns | **13x** |
| **smol-vfs** | ParseOctal | ~100ns | ~20ns | **5x** |
| **smol-vfs** | VerifyHeader | ~600ns | ~60ns | **10x** |

## Implementation Phases

### Phase 1: Extract smol_simd.h
1. Create `smol_simd.h` with all utilities
2. Create `smol_simd.cc` with global variable
3. Update `smol_http_binding.cc` to use shared header
4. Add `smol_simd.gypi` to build

### Phase 2: smol-ilp Bindings
1. Create `smol_ilp_binding.h/cc`
2. Create `smol_ilp_v8_binding.cc`
3. Add `smol_ilp.gypi` to build
4. Update JS to use native bindings
5. Add tests

### Phase 3: smol-vfs Bindings
1. Create `smol_vfs_binding.h/cc`
2. Create `smol_vfs_v8_binding.cc`
3. Add `smol_vfs.gypi` to build
4. Update TAR parser to use native bindings
5. Add tests

### Phase 4: Integration
1. Benchmark all modules
2. Profile and optimize hot paths
3. Documentation updates
