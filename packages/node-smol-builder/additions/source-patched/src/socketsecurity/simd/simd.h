// simd.h
// Cross-platform SIMD utilities for socketsecurity modules
// Supports: Windows, macOS, Linux on x86_64, x86, ARM64, ARM32

#ifndef SRC_SOCKETSECURITY_SIMD_H_
#define SRC_SOCKETSECURITY_SIMD_H_

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

#if defined(__x86_64__) || defined(_M_X64)
  #define SMOL_ARCH_X64 1
#elif defined(__i386__) || defined(_M_IX86)
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
  // SSE2 is always available on x64, and we check for it on x86
  #if defined(__SSE2__) || defined(_M_X64) || (defined(_M_IX86_FP) && _M_IX86_FP >= 2)
    #define SMOL_HAS_SSE2 1
    #include <emmintrin.h>  // SSE2
  #endif

  #if defined(__SSSE3__)
    #define SMOL_HAS_SSSE3 1
    #include <tmmintrin.h>  // SSSE3
  #endif

  #if defined(__SSE4_1__)
    #define SMOL_HAS_SSE41 1
    #include <smmintrin.h>  // SSE4.1
  #endif

  #if defined(__SSE4_2__) || defined(__AVX2__)
    #define SMOL_HAS_SSE42 1
    #include <nmmintrin.h>  // SSE4.2
  #endif

  #if defined(__AVX2__)
    #define SMOL_COMPILE_AVX2 1
    #include <immintrin.h>  // AVX2
  #endif

  // CPUID for runtime AVX2 detection
  #if SMOL_PLATFORM_WINDOWS
    #include <intrin.h>
  #else
    #include <cpuid.h>
  #endif
#endif

#if SMOL_ARCH_ARM64 || SMOL_ARCH_ARM32
  #if defined(__ARM_NEON) || defined(__ARM_NEON__)
    #define SMOL_HAS_NEON 1
    #include <arm_neon.h>
  #endif
#endif

// ============================================================================
// COMPILER HINTS
// ============================================================================

#if defined(__GNUC__) || defined(__clang__)
  #define SMOL_LIKELY(x)       __builtin_expect(!!(x), 1)
  #define SMOL_UNLIKELY(x)     __builtin_expect(!!(x), 0)
  #define SMOL_FORCE_INLINE    __attribute__((always_inline)) inline
  #define SMOL_NOINLINE        __attribute__((noinline))
  #define SMOL_ALIGNED(n)      __attribute__((aligned(n)))
  #define SMOL_RESTRICT        __restrict__
#elif defined(_MSC_VER)
  #define SMOL_LIKELY(x)       (x)
  #define SMOL_UNLIKELY(x)     (x)
  #define SMOL_FORCE_INLINE    __forceinline
  #define SMOL_NOINLINE        __declspec(noinline)
  #define SMOL_ALIGNED(n)      __declspec(align(n))
  #define SMOL_RESTRICT        __restrict
#else
  #define SMOL_LIKELY(x)       (x)
  #define SMOL_UNLIKELY(x)     (x)
  #define SMOL_FORCE_INLINE    inline
  #define SMOL_NOINLINE
  #define SMOL_ALIGNED(n)
  #define SMOL_RESTRICT
#endif

namespace smol {
namespace simd {

// ============================================================================
// RUNTIME AVX2 DETECTION
// ============================================================================

// Global flag set at initialization
extern bool g_has_avx2;

// Initialize SIMD detection - call once at startup
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
    } else {
      g_has_avx2 = false;
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
  if (x == 0) return 32;
#if defined(_MSC_VER)
  unsigned long idx;
  _BitScanForward(&idx, x);
  return static_cast<int>(idx);
#else
  return __builtin_ctz(x);
#endif
}

SMOL_FORCE_INLINE int CountTrailingZeros64(uint64_t x) {
  if (x == 0) return 64;
#if defined(_MSC_VER)
  #if defined(_M_X64) || defined(_M_ARM64)
    unsigned long idx;
    _BitScanForward64(&idx, x);
    return static_cast<int>(idx);
  #else
    // 32-bit MSVC fallback
    unsigned long idx;
    if (_BitScanForward(&idx, static_cast<uint32_t>(x))) {
      return static_cast<int>(idx);
    }
    _BitScanForward(&idx, static_cast<uint32_t>(x >> 32));
    return static_cast<int>(idx) + 32;
  #endif
#else
  return __builtin_ctzll(x);
#endif
}

SMOL_FORCE_INLINE int CountLeadingZeros(uint32_t x) {
  if (x == 0) return 32;
#if defined(_MSC_VER)
  unsigned long idx;
  _BitScanReverse(&idx, x);
  return 31 - static_cast<int>(idx);
#else
  return __builtin_clz(x);
#endif
}

SMOL_FORCE_INLINE int PopCount(uint32_t x) {
#if defined(_MSC_VER)
  return __popcnt(x);
#else
  return __builtin_popcount(x);
#endif
}

// ============================================================================
// FIND CHARACTER (memchr-like, SIMD accelerated)
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
      return s + i + CountTrailingZeros(static_cast<uint32_t>(mask));
    }
  }

  // Scalar remainder
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
      return s + i + CountTrailingZeros(static_cast<uint32_t>(mask));
    }
  }

  // Fall through to SSE2 for remainder
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

  // Scalar remainder
  for (; i < len; i++) {
    if (s[i] == c) return s + i;
  }
  return nullptr;
}
#endif

inline const char* FindChar(const char* s, size_t len, char c) {
#if SMOL_COMPILE_AVX2
  if (g_has_avx2 && len >= 32) return FindCharAVX2(s, len, c);
#endif
#if SMOL_HAS_SSE2
  if (len >= 16) return FindCharSSE2(s, len, c);
#elif SMOL_HAS_NEON
  if (len >= 16) return FindCharNEON(s, len, c);
#endif
  return FindCharScalar(s, len, c);
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
      return i + CountTrailingZeros(static_cast<uint32_t>(mask));
    }
  }

  // Scalar remainder
  for (; i < len; i++) {
    char ch = s[i];
    if (ch == c1 || ch == c2 || ch == c3 || ch == c4) return i;
  }
  return len;
}
#endif

inline size_t FindAnyOf(const char* s, size_t len, char c1, char c2, char c3 = 0, char c4 = 0) {
#if SMOL_HAS_SSE2
  if (len >= 16) return FindAnyOfSSE2(s, len, c1, c2, c3, c4);
#endif
  for (size_t i = 0; i < len; i++) {
    char ch = s[i];
    if (ch == c1 || ch == c2 || ch == c3 || ch == c4) return i;
  }
  return len;
}

// ============================================================================
// TO LOWERCASE (In-Place, SIMD accelerated)
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

  // Scalar remainder
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

  // Scalar remainder
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

// Copy with lowercase conversion
inline void ToLowerCopy(const char* src, char* dst, size_t len) {
#if SMOL_HAS_SSE2
  const __m128i upper_a = _mm_set1_epi8('A' - 1);
  const __m128i upper_z = _mm_set1_epi8('Z' + 1);
  const __m128i to_lower = _mm_set1_epi8(0x20);
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(src + i));
    __m128i gt_a = _mm_cmpgt_epi8(chunk, upper_a);
    __m128i lt_z = _mm_cmplt_epi8(chunk, upper_z);
    __m128i is_upper = _mm_and_si128(gt_a, lt_z);
    __m128i lower_mask = _mm_and_si128(is_upper, to_lower);
    chunk = _mm_or_si128(chunk, lower_mask);
    _mm_storeu_si128(reinterpret_cast<__m128i*>(dst + i), chunk);
  }

  for (; i < len; i++) {
    char c = src[i];
    dst[i] = (c >= 'A' && c <= 'Z') ? c + 0x20 : c;
  }
#else
  for (size_t i = 0; i < len; i++) {
    char c = src[i];
    dst[i] = (c >= 'A' && c <= 'Z') ? c + 0x20 : c;
  }
#endif
}

// ============================================================================
// XOR REPEAT 4 (WebSocket Masking, SIMD accelerated)
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

  // SSE2 for 16-31 bytes
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
  if (g_has_avx2 && len >= 32) { XorRepeat4AVX2(data, len, key); return; }
#endif
#if SMOL_HAS_SSE2
  if (len >= 16) { XorRepeat4SSE2(data, len, key); return; }
#elif SMOL_HAS_NEON
  if (len >= 16) { XorRepeat4NEON(data, len, key); return; }
#endif
  // Scalar fallback
  const uint8_t* kb = reinterpret_cast<const uint8_t*>(&key);
  for (size_t i = 0; i < len; i++) {
    data[i] ^= kb[i & 3];
  }
}

// ============================================================================
// CHECKSUM (Sum of bytes - for TAR headers, SIMD accelerated)
// ============================================================================

#if SMOL_HAS_SSE2
SMOL_FORCE_INLINE uint32_t ChecksumSSE2(const uint8_t* data, size_t len) {
  __m128i sum = _mm_setzero_si128();
  __m128i zero = _mm_setzero_si128();
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i*>(data + i));
    // Unpack bytes to 16-bit, then 32-bit for accumulation
    __m128i lo = _mm_unpacklo_epi8(chunk, zero);
    __m128i hi = _mm_unpackhi_epi8(chunk, zero);
    sum = _mm_add_epi32(sum, _mm_unpacklo_epi16(lo, zero));
    sum = _mm_add_epi32(sum, _mm_unpackhi_epi16(lo, zero));
    sum = _mm_add_epi32(sum, _mm_unpacklo_epi16(hi, zero));
    sum = _mm_add_epi32(sum, _mm_unpackhi_epi16(hi, zero));
  }

  // Horizontal sum of 4 lanes
  __m128i sum2 = _mm_shuffle_epi32(sum, _MM_SHUFFLE(2, 3, 0, 1));
  sum = _mm_add_epi32(sum, sum2);
  sum2 = _mm_shuffle_epi32(sum, _MM_SHUFFLE(1, 0, 3, 2));
  sum = _mm_add_epi32(sum, sum2);

  uint32_t result = static_cast<uint32_t>(_mm_cvtsi128_si32(sum));

  // Scalar remainder
  for (; i < len; i++) {
    result += data[i];
  }

  return result;
}
#endif

#if SMOL_HAS_NEON
SMOL_FORCE_INLINE uint32_t ChecksumNEON(const uint8_t* data, size_t len) {
  uint32x4_t sum = vdupq_n_u32(0);
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    uint8x16_t chunk = vld1q_u8(data + i);
    // Sum pairs of bytes to 16-bit
    uint16x8_t sum16 = vpaddlq_u8(chunk);
    // Sum pairs of 16-bit to 32-bit
    uint32x4_t sum32 = vpaddlq_u16(sum16);
    sum = vaddq_u32(sum, sum32);
  }

  // Horizontal sum
  uint32_t result = vaddvq_u32(sum);

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
#elif SMOL_HAS_NEON
  return ChecksumNEON(data, len);
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
    char c = s[i];
    if (c < '0' || c > '9') break;
    result = result * 10 + static_cast<uint64_t>(c - '0');
  }
  return result;
}

// SIMD digit parsing for 8+ digits (significant speedup for version numbers)
#if SMOL_HAS_SSSE3
SMOL_FORCE_INLINE uint64_t ParseDigits8SSSE3(const char* s) {
  // Load 8 bytes
  __m128i chunk = _mm_loadl_epi64(reinterpret_cast<const __m128i*>(s));

  // Subtract '0' to get digit values
  __m128i zero_char = _mm_set1_epi8('0');
  chunk = _mm_sub_epi8(chunk, zero_char);

  // Multiply by powers of 10 using multiply-add (SSSE3)
  const __m128i mult1 = _mm_setr_epi8(10, 1, 10, 1, 10, 1, 10, 1, 0, 0, 0, 0, 0, 0, 0, 0);
  chunk = _mm_maddubs_epi16(chunk, mult1);  // Now have 4x 16-bit values

  const __m128i mult2 = _mm_setr_epi16(100, 1, 100, 1, 0, 0, 0, 0);
  chunk = _mm_madd_epi16(chunk, mult2);  // Now have 2x 32-bit values

  // Extract and combine
  uint32_t lo = static_cast<uint32_t>(_mm_cvtsi128_si32(chunk));
  uint32_t hi = static_cast<uint32_t>(_mm_cvtsi128_si32(_mm_shuffle_epi32(chunk, 1)));

  return static_cast<uint64_t>(hi) * 10000 + lo;
}
#endif

inline uint64_t ParseDigits(const char* s, size_t len) {
  // For short strings, scalar is fast enough
#if SMOL_HAS_SSSE3
  if (len == 8) return ParseDigits8SSSE3(s);
#endif
  return ParseDigitsScalar(s, len);
}

// ============================================================================
// NEEDS ESCAPE (ILP protocol - check if string needs escaping)
// Escape chars: space, comma, equals, backslash, newline, carriage return
// ============================================================================

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

  // Scalar remainder
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
  if (len >= 16) return NeedsEscapeSSE2(s, len);
#endif
  for (size_t i = 0; i < len; i++) {
    char c = s[i];
    if (c == ' ' || c == ',' || c == '=' || c == '\\' || c == '\n' || c == '\r') {
      return true;
    }
  }
  return false;
}

// ============================================================================
// ESCAPE STRING (ILP protocol - escape special characters)
// Returns number of bytes written
// ============================================================================

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

// ============================================================================
// COMPARE STRINGS CASE-INSENSITIVELY
// ============================================================================

inline bool EqualsIgnoreCase(const char* a, size_t a_len, const char* b, size_t b_len) {
  if (a_len != b_len) return false;

  for (size_t i = 0; i < a_len; i++) {
    char ca = a[i];
    char cb = b[i];

    // Fast path: equal
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

// ============================================================================
// MEMORY OPERATIONS
// ============================================================================

// Fast memory copy for small buffers (uses rep movsb on modern CPUs)
SMOL_FORCE_INLINE void FastCopy(void* dst, const void* src, size_t len) {
  std::memcpy(dst, src, len);
}

// Fast memory set
SMOL_FORCE_INLINE void FastSet(void* dst, int val, size_t len) {
  std::memset(dst, val, len);
}

// Fast memory compare
SMOL_FORCE_INLINE int FastCmp(const void* a, const void* b, size_t len) {
  return std::memcmp(a, b, len);
}

}  // namespace simd
}  // namespace smol

#endif  // SRC_SOCKETSECURITY_SIMD_H_
