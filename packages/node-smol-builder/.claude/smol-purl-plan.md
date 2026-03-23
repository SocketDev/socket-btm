# smol-purl Implementation Plan

## Overview

`node:smol-purl` provides high-performance Package URL (PURL) parsing with SIMD-accelerated string operations. Target: **50-100x faster** than JavaScript implementations.

## Performance Strategy for 50-100x

### Key Optimizations
1. **Zero allocation hot path** - Pre-allocated arena, string_view only
2. **SIMD character scanning** - Find delimiters in 32/16 bytes at once
3. **Perfect hashing** - O(1) ecosystem type lookup with compile-time hash
4. **Memory-mapped input** - Avoid copy for large inputs
5. **Branch-free parsing** - Lookup tables instead of conditionals
6. **Inline everything** - Force inline critical functions
7. **Cache-aligned structures** - Prevent false sharing

## Reference Implementation

Based on `socket-packageurl-js`:
- Standard PURL spec compliance (pkg:type/namespace/name@version?qualifiers#subpath)
- 30+ ecosystem support
- URL encoding/decoding
- Qualifier parsing

## C++ Architecture

### Header: `smol_purl_binding.h`

```cpp
#ifndef SRC_SMOL_PURL_BINDING_H_
#define SRC_SMOL_PURL_BINDING_H_

#include <string>
#include <string_view>
#include <unordered_map>
#include <optional>
#include <vector>

namespace node {
namespace smol_purl {

// Ecosystem type enumeration for fast switching
enum class PurlType : uint8_t {
  kUnknown = 0,
  kNpm = 1,
  kMaven = 2,
  kPypi = 3,
  kNuget = 4,
  kGem = 5,
  kCargo = 6,
  kGolang = 7,
  kComposer = 8,
  kConan = 9,
  kConda = 10,
  kCran = 11,
  kDeb = 12,
  kDocker = 13,
  kGeneric = 14,
  kGithub = 15,
  kHackage = 16,
  kHex = 17,
  kMlflow = 18,
  kOci = 19,
  kPub = 20,
  kRpm = 21,
  kSwid = 22,
  kSwift = 23,
  // ... additional types
};

// Parsed PURL structure (stack-allocated where possible)
struct ParsedPurl {
  PurlType type;
  std::string_view type_str;
  std::string_view namespace_part;
  std::string_view name;
  std::string_view version;
  std::string_view qualifiers_raw;
  std::string_view subpath;

  // Decoded strings (only allocated if URL-encoded)
  std::string namespace_decoded;
  std::string name_decoded;
  std::string version_decoded;
  std::string subpath_decoded;

  // Qualifier map (lazy-parsed)
  mutable std::optional<std::unordered_map<std::string, std::string>> qualifiers;

  bool valid = false;
  const char* error = nullptr;
};

// SIMD-accelerated parsing
class PurlParser {
 public:
  // Parse a PURL string
  static ParsedPurl Parse(std::string_view input);

  // Parse with pre-allocated output (zero-alloc path)
  static bool ParseInto(std::string_view input, ParsedPurl* output);

  // Batch parse multiple PURLs (SIMD vectorized)
  static std::vector<ParsedPurl> ParseBatch(
      const std::vector<std::string_view>& inputs);

  // Type string to enum (perfect hash)
  static PurlType TypeFromString(std::string_view type);

  // Enum to canonical type string
  static std::string_view TypeToString(PurlType type);

 private:
  // SIMD character class detection
  static size_t FindDelimiter(std::string_view input, char delim);
  static size_t FindAnyOf(std::string_view input, const char* chars);

  // URL decode with SIMD acceleration
  static std::string UrlDecode(std::string_view input);
  static bool NeedsDecoding(std::string_view input);

  // Parse qualifiers lazily
  static std::unordered_map<std::string, std::string>
      ParseQualifiers(std::string_view raw);
};

// PURL builder for construction
class PurlBuilder {
 public:
  PurlBuilder& SetType(PurlType type);
  PurlBuilder& SetType(std::string_view type);
  PurlBuilder& SetNamespace(std::string_view ns);
  PurlBuilder& SetName(std::string_view name);
  PurlBuilder& SetVersion(std::string_view version);
  PurlBuilder& SetQualifier(std::string_view key, std::string_view value);
  PurlBuilder& SetSubpath(std::string_view subpath);

  std::string Build() const;

  // Build with pre-sized buffer (zero-alloc if buffer sufficient)
  size_t BuildInto(char* buffer, size_t size) const;

 private:
  PurlType type_ = PurlType::kUnknown;
  std::string type_str_;
  std::string namespace_;
  std::string name_;
  std::string version_;
  std::unordered_map<std::string, std::string> qualifiers_;
  std::string subpath_;
};

// LRU cache for parsed PURLs
class PurlCache {
 public:
  explicit PurlCache(size_t max_size = 10000);

  const ParsedPurl* Get(std::string_view purl) const;
  void Put(std::string_view purl, ParsedPurl parsed);
  void Clear();

  size_t size() const;
  size_t hits() const;
  size_t misses() const;

 private:
  struct Entry {
    std::string key;
    ParsedPurl value;
  };
  // LRU implementation details...
};

}  // namespace smol_purl
}  // namespace node

#endif  // SRC_SMOL_PURL_BINDING_H_
```

### V8 Binding: `smol_purl_v8_binding.cc`

```cpp
#include "smol_purl_binding.h"
#include "env-inl.h"
#include "node_internals.h"
#include "v8.h"

namespace node {
namespace smol_purl {

using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

// Fast path: parse and return object
void Parse(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1 || !args[0]->IsString()) {
    isolate->ThrowException(v8::Exception::TypeError(
        String::NewFromUtf8Literal(isolate, "Expected string argument")));
    return;
  }

  v8::String::Utf8Value input(isolate, args[0]);
  std::string_view sv(*input, input.length());

  ParsedPurl result = PurlParser::Parse(sv);

  if (!result.valid) {
    isolate->ThrowException(v8::Exception::Error(
        String::NewFromUtf8(isolate, result.error).ToLocalChecked()));
    return;
  }

  // Build result object
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> obj = Object::New(isolate);

  // Set properties (use external strings for zero-copy where possible)
  obj->Set(context,
      String::NewFromUtf8Literal(isolate, "type"),
      String::NewFromUtf8(isolate,
          result.type_str.data(),
          v8::NewStringType::kNormal,
          result.type_str.length()).ToLocalChecked()
  ).Check();

  // ... set other properties

  args.GetReturnValue().Set(obj);
}

// Batch parse for bulk operations
void ParseBatch(const FunctionCallbackInfo<Value>& args) {
  // Implementation for parsing arrays of PURLs
}

// Build PURL from components
void Build(const FunctionCallbackInfo<Value>& args) {
  // Implementation
}

void Initialize(Local<Object> target,
                Local<Value> unused,
                Local<Context> context,
                void* priv) {
  Environment* env = Environment::GetCurrent(context);

  env->SetMethod(target, "parse", Parse);
  env->SetMethod(target, "parseBatch", ParseBatch);
  env->SetMethod(target, "build", Build);
}

NODE_MODULE_CONTEXT_AWARE_INTERNAL(smol_purl, Initialize)

}  // namespace smol_purl
}  // namespace node
```

## Cross-Platform SIMD Architecture

### Platform Detection Header: `smol_simd.h`

```cpp
#ifndef SRC_SMOL_SIMD_H_
#define SRC_SMOL_SIMD_H_

// ============================================================================
// PLATFORM DETECTION
// ============================================================================

// x86/x64 detection
#if defined(_M_X64) || defined(__x86_64__) || defined(_M_IX86) || defined(__i386__)
  #define SMOL_ARCH_X86 1
  #if defined(_M_X64) || defined(__x86_64__)
    #define SMOL_ARCH_X64 1
  #endif
#endif

// ARM detection
#if defined(__arm__) || defined(_M_ARM)
  #define SMOL_ARCH_ARM32 1
#endif
#if defined(__aarch64__) || defined(_M_ARM64)
  #define SMOL_ARCH_ARM64 1
#endif

// ============================================================================
// SIMD FEATURE DETECTION
// ============================================================================

#if SMOL_ARCH_X86
  // Windows
  #if defined(_MSC_VER)
    #include <intrin.h>
    #define SMOL_HAS_SSE2 1  // Always available on x64
    // Runtime detection for AVX2
    inline bool smol_has_avx2() {
      int cpuInfo[4];
      __cpuidex(cpuInfo, 7, 0);
      return (cpuInfo[1] & (1 << 5)) != 0;  // AVX2 bit
    }
  // GCC/Clang
  #else
    #include <cpuid.h>
    #define SMOL_HAS_SSE2 1
    inline bool smol_has_avx2() {
      unsigned int eax, ebx, ecx, edx;
      if (__get_cpuid_count(7, 0, &eax, &ebx, &ecx, &edx)) {
        return (ebx & (1 << 5)) != 0;
      }
      return false;
    }
  #endif

  #include <emmintrin.h>   // SSE2
  #if defined(__SSE4_2__) || defined(__AVX2__)
    #include <nmmintrin.h> // SSE4.2
  #endif
  #if defined(__AVX2__)
    #include <immintrin.h> // AVX2
    #define SMOL_COMPILE_AVX2 1
  #endif
#endif

#if SMOL_ARCH_ARM64 || SMOL_ARCH_ARM32
  #include <arm_neon.h>
  #define SMOL_HAS_NEON 1
#endif

// ============================================================================
// PORTABLE SIMD TYPES
// ============================================================================

namespace smol {
namespace simd {

// Runtime dispatch flag (set once at startup)
extern bool g_has_avx2;

inline void InitSIMD() {
#if SMOL_ARCH_X86
  g_has_avx2 = smol_has_avx2();
#else
  g_has_avx2 = false;
#endif
}

// ============================================================================
// FIND DELIMITER - Scans for single character
// ============================================================================

// Scalar fallback (always available)
SMOL_FORCE_INLINE size_t FindDelimiterScalar(
    const char* data, size_t len, char delim) {
  for (size_t i = 0; i < len; i++) {
    if (data[i] == delim) return i;
  }
  return len;
}

#if SMOL_HAS_SSE2
SMOL_FORCE_INLINE size_t FindDelimiterSSE2(
    const char* data, size_t len, char delim) {
  __m128i needle = _mm_set1_epi8(delim);
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    __m128i chunk = _mm_loadu_si128(
        reinterpret_cast<const __m128i*>(data + i));
    __m128i cmp = _mm_cmpeq_epi8(chunk, needle);
    int mask = _mm_movemask_epi8(cmp);
    if (mask) {
      // Count trailing zeros - cross-platform
      #if defined(_MSC_VER)
        unsigned long idx;
        _BitScanForward(&idx, mask);
        return i + idx;
      #else
        return i + __builtin_ctz(mask);
      #endif
    }
  }

  return i + FindDelimiterScalar(data + i, len - i, delim);
}
#endif

#if SMOL_COMPILE_AVX2
SMOL_FORCE_INLINE size_t FindDelimiterAVX2(
    const char* data, size_t len, char delim) {
  __m256i needle = _mm256_set1_epi8(delim);
  size_t i = 0;

  for (; i + 32 <= len; i += 32) {
    __m256i chunk = _mm256_loadu_si256(
        reinterpret_cast<const __m256i*>(data + i));
    __m256i cmp = _mm256_cmpeq_epi8(chunk, needle);
    int mask = _mm256_movemask_epi8(cmp);
    if (mask) {
      #if defined(_MSC_VER)
        unsigned long idx;
        _BitScanForward(&idx, mask);
        return i + idx;
      #else
        return i + __builtin_ctz(mask);
      #endif
    }
  }

  // Handle remainder with SSE2
  return i + FindDelimiterSSE2(data + i, len - i, delim);
}
#endif

#if SMOL_HAS_NEON
SMOL_FORCE_INLINE size_t FindDelimiterNEON(
    const char* data, size_t len, char delim) {
  uint8x16_t needle = vdupq_n_u8(static_cast<uint8_t>(delim));
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    uint8x16_t chunk = vld1q_u8(
        reinterpret_cast<const uint8_t*>(data + i));
    uint8x16_t cmp = vceqq_u8(chunk, needle);

    // Reduce to check if any match
    uint64x2_t cmp64 = vreinterpretq_u64_u8(cmp);
    uint64_t combined = vgetq_lane_u64(cmp64, 0) | vgetq_lane_u64(cmp64, 1);
    if (combined) {
      // Find exact position with CLZ
      #if SMOL_ARCH_ARM64
        // Use NEON shrn + clz for fast position finding
        uint8x8_t narrow = vshrn_n_u16(vreinterpretq_u16_u8(cmp), 4);
        uint64_t bits = vget_lane_u64(vreinterpret_u64_u8(narrow), 0);
        int pos = __builtin_ctzll(bits) / 4;
        return i + pos;
      #else
        for (size_t j = 0; j < 16 && i + j < len; j++) {
          if (data[i + j] == delim) return i + j;
        }
      #endif
    }
  }

  return i + FindDelimiterScalar(data + i, len - i, delim);
}
#endif

// Runtime dispatch
inline size_t FindDelimiter(const char* data, size_t len, char delim) {
#if SMOL_COMPILE_AVX2
  if (g_has_avx2) {
    return FindDelimiterAVX2(data, len, delim);
  }
#endif
#if SMOL_HAS_SSE2
  return FindDelimiterSSE2(data, len, delim);
#elif SMOL_HAS_NEON
  return FindDelimiterNEON(data, len, delim);
#else
  return FindDelimiterScalar(data, len, delim);
#endif
}

// ============================================================================
// FIND ANY OF - Scans for any of multiple characters
// ============================================================================

#if SMOL_HAS_SSE2
SMOL_FORCE_INLINE size_t FindAnyOfSSE2(
    const char* data, size_t len,
    char c1, char c2, char c3 = 0, char c4 = 0) {
  __m128i n1 = _mm_set1_epi8(c1);
  __m128i n2 = _mm_set1_epi8(c2);
  __m128i n3 = _mm_set1_epi8(c3);
  __m128i n4 = _mm_set1_epi8(c4);
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    __m128i chunk = _mm_loadu_si128(
        reinterpret_cast<const __m128i*>(data + i));
    __m128i cmp = _mm_or_si128(
        _mm_or_si128(_mm_cmpeq_epi8(chunk, n1), _mm_cmpeq_epi8(chunk, n2)),
        _mm_or_si128(_mm_cmpeq_epi8(chunk, n3), _mm_cmpeq_epi8(chunk, n4)));
    int mask = _mm_movemask_epi8(cmp);
    if (mask) {
      #if defined(_MSC_VER)
        unsigned long idx;
        _BitScanForward(&idx, mask);
        return i + idx;
      #else
        return i + __builtin_ctz(mask);
      #endif
    }
  }

  // Scalar remainder
  for (; i < len; i++) {
    char c = data[i];
    if (c == c1 || c == c2 || c == c3 || c == c4) return i;
  }
  return len;
}
#endif

// ============================================================================
// URL DECODE SIMD - Check if decoding needed
// ============================================================================

SMOL_FORCE_INLINE bool NeedsUrlDecode(const char* data, size_t len) {
#if SMOL_HAS_SSE2
  __m128i percent = _mm_set1_epi8('%');
  __m128i plus = _mm_set1_epi8('+');
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    __m128i chunk = _mm_loadu_si128(
        reinterpret_cast<const __m128i*>(data + i));
    __m128i cmp = _mm_or_si128(
        _mm_cmpeq_epi8(chunk, percent),
        _mm_cmpeq_epi8(chunk, plus));
    if (_mm_movemask_epi8(cmp)) return true;
  }

  for (; i < len; i++) {
    if (data[i] == '%' || data[i] == '+') return true;
  }
  return false;

#elif SMOL_HAS_NEON
  uint8x16_t percent = vdupq_n_u8('%');
  uint8x16_t plus = vdupq_n_u8('+');
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    uint8x16_t chunk = vld1q_u8(
        reinterpret_cast<const uint8_t*>(data + i));
    uint8x16_t cmp = vorrq_u8(
        vceqq_u8(chunk, percent),
        vceqq_u8(chunk, plus));
    uint64x2_t cmp64 = vreinterpretq_u64_u8(cmp);
    if (vgetq_lane_u64(cmp64, 0) | vgetq_lane_u64(cmp64, 1)) return true;
  }

  for (; i < len; i++) {
    if (data[i] == '%' || data[i] == '+') return true;
  }
  return false;

#else
  for (size_t i = 0; i < len; i++) {
    if (data[i] == '%' || data[i] == '+') return true;
  }
  return false;
#endif
}

}  // namespace simd
}  // namespace smol

// Force inline macro
#if defined(_MSC_VER)
  #define SMOL_FORCE_INLINE __forceinline
#else
  #define SMOL_FORCE_INLINE __attribute__((always_inline)) inline
#endif

#endif  // SRC_SMOL_SIMD_H_
```

### Perfect Hash for Ecosystem Types

```cpp
// Compile-time perfect hash for ecosystem strings
// Eliminates all string comparisons at runtime

constexpr uint32_t FNV1a(const char* s, size_t len) {
  uint32_t hash = 2166136261u;
  for (size_t i = 0; i < len; i++) {
    hash ^= static_cast<uint8_t>(s[i]);
    hash *= 16777619u;
  }
  return hash;
}

constexpr uint32_t operator""_hash(const char* s, size_t len) {
  return FNV1a(s, len);
}

PurlType TypeFromString(std::string_view type) {
  // Convert to lowercase and hash in one pass
  uint32_t hash = 2166136261u;
  for (char c : type) {
    hash ^= static_cast<uint8_t>(c | 0x20);  // Lowercase
    hash *= 16777619u;
  }

  switch (hash) {
    case "npm"_hash:      return PurlType::kNpm;
    case "maven"_hash:    return PurlType::kMaven;
    case "pypi"_hash:     return PurlType::kPypi;
    case "nuget"_hash:    return PurlType::kNuget;
    case "gem"_hash:      return PurlType::kGem;
    case "cargo"_hash:    return PurlType::kCargo;
    case "golang"_hash:   return PurlType::kGolang;
    case "go"_hash:       return PurlType::kGolang;
    case "composer"_hash: return PurlType::kComposer;
    case "docker"_hash:   return PurlType::kDocker;
    case "github"_hash:   return PurlType::kGithub;
    // ... 20+ more
    default:              return PurlType::kUnknown;
  }
}
```

### Arena Allocator for Zero-Alloc Parsing

```cpp
// Thread-local arena for zero-allocation parsing
class ParseArena {
 public:
  static constexpr size_t kPageSize = 64 * 1024;  // 64KB pages

  char* Alloc(size_t size) {
    size = (size + 7) & ~7;  // 8-byte align
    if (pos_ + size > kPageSize) {
      Reset();  // Reuse same page
    }
    char* ptr = buffer_ + pos_;
    pos_ += size;
    return ptr;
  }

  void Reset() { pos_ = 0; }

  // Pre-allocated buffer
  alignas(64) char buffer_[kPageSize];
  size_t pos_ = 0;
};

thread_local ParseArena g_arena;
```

### Branch-Free Hex Decode

```cpp
// Lookup table for hex decode (256 entries)
// Invalid chars map to 255
alignas(64) constexpr uint8_t kHexTable[256] = {
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  0,1,2,3,4,5,6,7,8,9,255,255,255,255,255,255,  // 0-9
  255,10,11,12,13,14,15,255,255,255,255,255,255,255,255,255,  // A-F
  255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
  255,10,11,12,13,14,15,255,255,255,255,255,255,255,255,255,  // a-f
  // ... rest are 255
};

// Branch-free hex pair decode
SMOL_FORCE_INLINE int DecodeHexPair(char hi, char lo) {
  uint8_t h = kHexTable[static_cast<uint8_t>(hi)];
  uint8_t l = kHexTable[static_cast<uint8_t>(lo)];
  // Returns -1 if invalid (h|l has bit 7 set)
  return ((h | l) & 0x80) ? -1 : (h << 4) | l;
}
```

## TypeScript Interface

### `lib/internal/smol_purl.d.ts`

```typescript
declare module 'node:smol-purl' {
  export type PurlType =
    | 'npm' | 'maven' | 'pypi' | 'nuget' | 'gem' | 'cargo'
    | 'golang' | 'composer' | 'conan' | 'conda' | 'cran'
    | 'deb' | 'docker' | 'generic' | 'github' | 'hackage'
    | 'hex' | 'mlflow' | 'oci' | 'pub' | 'rpm' | 'swid' | 'swift'
    | string;

  export interface ParsedPurl {
    /** Package type/ecosystem */
    readonly type: PurlType;
    /** Optional namespace (org, group, scope) */
    readonly namespace: string | null;
    /** Package name */
    readonly name: string;
    /** Optional version */
    readonly version: string | null;
    /** Optional qualifiers */
    readonly qualifiers: Readonly<Record<string, string>> | null;
    /** Optional subpath */
    readonly subpath: string | null;
  }

  /**
   * Parse a Package URL string
   * @throws Error if PURL is invalid
   */
  export function parse(purl: string): ParsedPurl;

  /**
   * Parse multiple PURLs (SIMD-accelerated batch)
   * Returns array with null for invalid entries
   */
  export function parseBatch(purls: string[]): (ParsedPurl | null)[];

  /**
   * Try to parse, returns null on failure instead of throwing
   */
  export function tryParse(purl: string): ParsedPurl | null;

  /**
   * Build a PURL string from components
   */
  export function build(options: {
    type: PurlType;
    namespace?: string | null;
    name: string;
    version?: string | null;
    qualifiers?: Record<string, string> | null;
    subpath?: string | null;
  }): string;

  /**
   * Validate a PURL string
   */
  export function isValid(purl: string): boolean;

  /**
   * Normalize a PURL (lowercase type, sort qualifiers)
   */
  export function normalize(purl: string): string;

  /**
   * Compare two PURLs for equality (ignoring qualifier order)
   */
  export function equals(a: string, b: string): boolean;

  /**
   * Cache statistics
   */
  export interface CacheStats {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  }

  /**
   * Get cache statistics
   */
  export function cacheStats(): CacheStats;

  /**
   * Clear the PURL cache
   */
  export function clearCache(): void;

  /**
   * PURL type constants
   */
  export const types: {
    readonly NPM: 'npm';
    readonly MAVEN: 'maven';
    readonly PYPI: 'pypi';
    readonly NUGET: 'nuget';
    readonly GEM: 'gem';
    readonly CARGO: 'cargo';
    readonly GOLANG: 'golang';
    // ... etc
  };
}
```

## JavaScript Wrapper

### `lib/internal/smol_purl.js`

```javascript
'use strict';

const binding = internalBinding('smol_purl');

// Re-export native functions
const { parse: nativeParse, parseBatch, build, cacheStats, clearCache } = binding;

// Wrap parse to add convenience methods
function parse(purl) {
  const result = nativeParse(purl);
  // Freeze for immutability
  if (result.qualifiers) {
    Object.freeze(result.qualifiers);
  }
  return Object.freeze(result);
}

function tryParse(purl) {
  try {
    return parse(purl);
  } catch {
    return null;
  }
}

function isValid(purl) {
  return tryParse(purl) !== null;
}

function normalize(purl) {
  const parsed = parse(purl);
  return build({
    type: parsed.type.toLowerCase(),
    namespace: parsed.namespace,
    name: parsed.name,
    version: parsed.version,
    qualifiers: parsed.qualifiers ?
      Object.fromEntries(
        Object.entries(parsed.qualifiers).sort(([a], [b]) => a.localeCompare(b))
      ) : null,
    subpath: parsed.subpath,
  });
}

function equals(a, b) {
  return normalize(a) === normalize(b);
}

const types = Object.freeze({
  NPM: 'npm',
  MAVEN: 'maven',
  PYPI: 'pypi',
  NUGET: 'nuget',
  GEM: 'gem',
  CARGO: 'cargo',
  GOLANG: 'golang',
  COMPOSER: 'composer',
  CONAN: 'conan',
  CONDA: 'conda',
  CRAN: 'cran',
  DEB: 'deb',
  DOCKER: 'docker',
  GENERIC: 'generic',
  GITHUB: 'github',
  HACKAGE: 'hackage',
  HEX: 'hex',
  MLFLOW: 'mlflow',
  OCI: 'oci',
  PUB: 'pub',
  RPM: 'rpm',
  SWID: 'swid',
  SWIFT: 'swift',
});

module.exports = {
  parse,
  tryParse,
  parseBatch,
  build,
  isValid,
  normalize,
  equals,
  cacheStats,
  clearCache,
  types,
};
```

## Test Cases

### `test/parallel/test-smol-purl.js`

```javascript
'use strict';
const common = require('../common');
const assert = require('assert');
const purl = require('node:smol-purl');

// Basic parsing
{
  const result = purl.parse('pkg:npm/%40scope/name@1.0.0');
  assert.strictEqual(result.type, 'npm');
  assert.strictEqual(result.namespace, '@scope');
  assert.strictEqual(result.name, 'name');
  assert.strictEqual(result.version, '1.0.0');
}

// Maven with qualifiers
{
  const result = purl.parse('pkg:maven/org.apache/commons@1.0?type=jar&classifier=sources');
  assert.strictEqual(result.type, 'maven');
  assert.strictEqual(result.namespace, 'org.apache');
  assert.strictEqual(result.name, 'commons');
  assert.strictEqual(result.qualifiers.type, 'jar');
  assert.strictEqual(result.qualifiers.classifier, 'sources');
}

// PyPI normalization
{
  const result = purl.parse('pkg:pypi/Django_REST_Framework@3.14.0');
  assert.strictEqual(result.type, 'pypi');
  assert.strictEqual(result.name, 'Django_REST_Framework');
}

// GitHub with subpath
{
  const result = purl.parse('pkg:github/socketdev/socket-cli@1.0.0#packages/cli');
  assert.strictEqual(result.type, 'github');
  assert.strictEqual(result.namespace, 'socketdev');
  assert.strictEqual(result.name, 'socket-cli');
  assert.strictEqual(result.subpath, 'packages/cli');
}

// Invalid PURL
{
  assert.throws(() => purl.parse('not-a-purl'), /Invalid PURL/);
  assert.strictEqual(purl.tryParse('not-a-purl'), null);
  assert.strictEqual(purl.isValid('not-a-purl'), false);
}

// Build PURL
{
  const built = purl.build({
    type: 'npm',
    namespace: '@socket',
    name: 'cli',
    version: '1.0.0',
  });
  assert.strictEqual(built, 'pkg:npm/%40socket/cli@1.0.0');
}

// Batch parsing
{
  const purls = [
    'pkg:npm/lodash@4.17.21',
    'pkg:pypi/requests@2.28.0',
    'invalid',
    'pkg:cargo/serde@1.0.0',
  ];
  const results = purl.parseBatch(purls);
  assert.strictEqual(results.length, 4);
  assert.strictEqual(results[0].name, 'lodash');
  assert.strictEqual(results[1].name, 'requests');
  assert.strictEqual(results[2], null);
  assert.strictEqual(results[3].name, 'serde');
}

// Equality check
{
  assert(purl.equals(
    'pkg:npm/lodash@4.17.21',
    'pkg:NPM/lodash@4.17.21'
  ));
}

// Cache functionality
{
  purl.clearCache();
  purl.parse('pkg:npm/test@1.0.0');
  purl.parse('pkg:npm/test@1.0.0'); // Cache hit
  const stats = purl.cacheStats();
  assert(stats.hits >= 1);
}

console.log('All smol-purl tests passed');
```

## Performance Targets (50-100x)

| Operation | Target | JS Baseline | Speedup |
|-----------|--------|-------------|---------|
| Simple parse | < 20ns | ~2µs | **100x** |
| Parse with qualifiers | < 50ns | ~3µs | **60x** |
| Batch parse (1000) | < 15µs | ~2ms | **130x** |
| Build PURL | < 15ns | ~1µs | **65x** |
| Validate | < 10ns | ~500ns | **50x** |
| Cache lookup | < 5ns | N/A | ∞ |

### How We Achieve 100x

1. **Zero allocations**: Arena allocator, string_view throughout
2. **SIMD scanning**: 32 bytes at once with AVX2, 16 with SSE2/NEON
3. **Perfect hashing**: Type lookup is single switch, no string compare
4. **Branch-free hex**: Lookup table instead of conditionals
5. **Inline everything**: No function call overhead on hot path
6. **Cache-aligned**: Structures aligned to 64 bytes (cache line)
7. **Pre-computed tables**: Hex decode, valid char masks at compile time

## Migration Path

### From socket-packageurl-js

```javascript
// Before
const PackageURL = require('@purl/packageurl-js');
const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21');
console.log(purl.name); // 'lodash'

// After
const purl = require('node:smol-purl');
const parsed = purl.parse('pkg:npm/lodash@4.17.21');
console.log(parsed.name); // 'lodash'
```

## Build Configuration

### `smol_purl.gypi`

```python
{
  'targets': [
    {
      'target_name': 'smol_purl',
      'type': 'static_library',
      'sources': [
        'smol_purl_binding.cc',
        'smol_purl_v8_binding.cc',
      ],
      'include_dirs': [
        '.',
        '<(node_root_dir)/src',
        '<(node_root_dir)/deps/v8/include',
      ],
      'dependencies': [
        '<(node_lib_target)',
      ],
      'defines': [
        'NODE_WANT_INTERNALS=1',
      ],
      'conditions': [
        # Windows
        ['OS=="win"', {
          'msvs_settings': {
            'VCCLCompilerTool': {
              'AdditionalOptions': ['/std:c++17', '/Zc:__cplusplus'],
              'EnableEnhancedInstructionSet': '2',  # SSE2 baseline
            },
          },
          'defines': ['WIN32_LEAN_AND_MEAN', 'NOMINMAX'],
        }],
        # macOS
        ['OS=="mac"', {
          'xcode_settings': {
            'CLANG_CXX_LANGUAGE_STANDARD': 'c++17',
            'CLANG_CXX_LIBRARY': 'libc++',
            'MACOSX_DEPLOYMENT_TARGET': '10.15',
            'OTHER_CPLUSPLUSFLAGS': ['-fno-exceptions', '-fno-rtti'],
          },
          'conditions': [
            ['target_arch=="x64"', {
              'xcode_settings': {
                'OTHER_CPLUSPLUSFLAGS': ['-msse4.2', '-mavx2'],
              },
              'defines': ['SMOL_ARCH_X64=1', 'SMOL_COMPILE_AVX2=1'],
            }],
            ['target_arch=="arm64"', {
              'xcode_settings': {
                'OTHER_CPLUSPLUSFLAGS': ['-march=armv8-a+simd'],
              },
              'defines': ['SMOL_ARCH_ARM64=1', 'SMOL_HAS_NEON=1'],
            }],
          ],
        }],
        # Linux
        ['OS=="linux"', {
          'cflags_cc': [
            '-std=c++17',
            '-fno-exceptions',
            '-fno-rtti',
            '-fvisibility=hidden',
          ],
          'conditions': [
            ['target_arch=="x64"', {
              'cflags_cc': ['-msse2', '-msse4.2'],
              'defines': ['SMOL_ARCH_X64=1', 'SMOL_HAS_SSE2=1'],
              # AVX2 detected at runtime
            }],
            ['target_arch=="arm64"', {
              'cflags_cc': ['-march=armv8-a+simd'],
              'defines': ['SMOL_ARCH_ARM64=1', 'SMOL_HAS_NEON=1'],
            }],
            ['target_arch=="arm"', {
              'cflags_cc': ['-mfpu=neon', '-mfloat-abi=hard'],
              'defines': ['SMOL_ARCH_ARM32=1', 'SMOL_HAS_NEON=1'],
            }],
          ],
        }],
        # FreeBSD/OpenBSD/NetBSD
        ['OS=="freebsd" or OS=="openbsd" or OS=="netbsd"', {
          'cflags_cc': ['-std=c++17', '-fno-exceptions', '-fno-rtti'],
        }],
      ],
    },
  ],
}
```

## Implementation Phases

### Phase 1: Core Parser
- Basic PURL parsing with string_view
- Type detection with perfect hash
- URL encoding/decoding
- V8 bindings

### Phase 2: SIMD Acceleration
- AVX2 delimiter search
- NEON implementation
- Batch processing

### Phase 3: Caching & Optimization
- LRU cache implementation
- Memory pooling
- Performance benchmarks

### Phase 4: Integration
- socket-cli integration
- coana-package-manager integration
- patch-cli integration
