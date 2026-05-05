// Implementation of the smol-versions parser + comparator.
//
// Performance notes
// =================
//
// The parser is a single-pass byte scanner. We deliberately avoid:
//
//   - regex (npm's `semver` uses several large regexes — they're
//     fast at steady-state but the JIT-warmup cost shows up in
//     scripts that parse just a few hundred versions);
//   - heap allocation for prerelease / build spans (we store
//     offsets into the source buffer, which the parser borrows);
//   - string copies inside comparison (we re-scan the offset
//     spans identifier-by-identifier, which is cheap because
//     prereleases are short).
//
// Spec reference: https://semver.org/spec/v2.0.0.html

#include "socketsecurity/versions/versions.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace node {
namespace socketsecurity {
namespace versions {

namespace {

// Predicate: is `c` an ASCII digit?
inline bool IsAsciiDigit(char c) { return c >= '0' && c <= '9'; }

// Predicate: is `c` allowed inside a semver identifier? (digits,
// letters, hyphen — everything else terminates the span)
inline bool IsIdentifierChar(char c) {
  return IsAsciiDigit(c) ||
         (c >= 'A' && c <= 'Z') ||
         (c >= 'a' && c <= 'z') ||
         c == '-';
}

// Predicate: a span composed entirely of digits is a "numeric
// identifier" per spec § 9. Numeric identifiers compare numerically;
// alphanumerics compare lexically; numerics sort below alphanumerics
// when mixed.
bool IsNumericIdentifier(const char* s, size_t len) {
  if (len == 0) {
    return false;
  }
  for (size_t i = 0; i < len; ++i) {
    if (!IsAsciiDigit(s[i])) {
      return false;
    }
  }
  return true;
}

// Parse a numeric identifier. Spec § 2: no leading zeros (except
// for the literal "0"). Returns false on overflow or leading zero.
bool ParseNumericIdent(const char* s, size_t len, uint64_t* out) {
  if (len == 0) {
    return false;
  }
  if (len > 1 && s[0] == '0') {
    return false;
  }
  uint64_t value = 0;
  for (size_t i = 0; i < len; ++i) {
    char c = s[i];
    if (!IsAsciiDigit(c)) {
      return false;
    }
    // Overflow guard: 18446744073709551615 has 20 digits; multiplying
    // by 10 + 9 from any value below ~1.8e18 is safe.
    if (value > (UINT64_MAX - 9) / 10) {
      return false;
    }
    value = value * 10 + static_cast<uint64_t>(c - '0');
  }
  *out = value;
  return true;
}

// Compare two prerelease identifier spans per spec § 11.
//   - Numeric vs numeric: numerically.
//   - Alphanumeric vs alphanumeric: lexically.
//   - Numeric vs alphanumeric: numeric is less.
int CompareIdentifier(const char* a, size_t a_len,
                      const char* b, size_t b_len) {
  bool a_numeric = IsNumericIdentifier(a, a_len);
  bool b_numeric = IsNumericIdentifier(b, b_len);
  if (a_numeric && b_numeric) {
    uint64_t av, bv;
    // ParseNumericIdent rejects leading zeros, but prerelease
    // identifiers are bytes-only here — fall back to length-then-
    // bytes if either parse fails (shouldn't, but defensive).
    if (!ParseNumericIdent(a, a_len, &av) ||
        !ParseNumericIdent(b, b_len, &bv)) {
      // Same-length lexical compare; otherwise shorter wins.
      if (a_len != b_len) {
        return a_len < b_len ? -1 : 1;
      }
      int cmp = std::memcmp(a, b, a_len);
      return cmp < 0 ? -1 : cmp > 0 ? 1 : 0;
    }
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  }
  if (a_numeric) {
    // Spec § 11: numeric identifiers always have lower precedence
    // than alphanumeric identifiers.
    return -1;
  }
  if (b_numeric) {
    return 1;
  }
  // Both alphanumeric: lexical, then length tiebreak.
  size_t min_len = a_len < b_len ? a_len : b_len;
  int cmp = std::memcmp(a, b, min_len);
  if (cmp != 0) {
    return cmp < 0 ? -1 : 1;
  }
  if (a_len != b_len) {
    return a_len < b_len ? -1 : 1;
  }
  return 0;
}

// Compare two prerelease spans identifier-by-identifier.
// Empty prerelease beats non-empty per spec § 11 (a normal version
// has higher precedence than a prerelease).
int ComparePrerelease(const char* a, size_t a_len,
                      const char* b, size_t b_len) {
  // Empty (no prerelease) vs non-empty: empty is greater.
  if (a_len == 0 && b_len == 0) return 0;
  if (a_len == 0) return 1;
  if (b_len == 0) return -1;

  size_t a_pos = 0;
  size_t b_pos = 0;
  while (a_pos < a_len && b_pos < b_len) {
    // Find the next dot (or end) in each side.
    size_t a_end = a_pos;
    while (a_end < a_len && a[a_end] != '.') a_end++;
    size_t b_end = b_pos;
    while (b_end < b_len && b[b_end] != '.') b_end++;

    int cmp = CompareIdentifier(a + a_pos, a_end - a_pos,
                                b + b_pos, b_end - b_pos);
    if (cmp != 0) {
      return cmp;
    }
    a_pos = a_end < a_len ? a_end + 1 : a_end;
    b_pos = b_end < b_len ? b_end + 1 : b_end;
  }
  // One ran out: the one with more identifiers wins.
  if (a_pos < a_len) return 1;
  if (b_pos < b_len) return -1;
  return 0;
}

// Skip ASCII whitespace.
inline void SkipWs(const char* s, size_t len, size_t* p) {
  while (*p < len &&
         (s[*p] == ' ' || s[*p] == '\t' || s[*p] == '\r' ||
          s[*p] == '\n' || s[*p] == '\f' || s[*p] == '\v')) {
    (*p)++;
  }
}

}  // namespace

// Parse a version: [v|=]MAJOR.MINOR.PATCH[-PRE][+BUILD], optionally
// surrounded by whitespace in loose mode.
bool ParseSemVer(const char* source, size_t len, bool loose, SemVer* out) {
  if (source == nullptr || len == 0 || out == nullptr) {
    return false;
  }
  size_t p = 0;
  if (loose) {
    SkipWs(source, len, &p);
    // Accept leading 'v' or '='.
    if (p < len && (source[p] == 'v' || source[p] == 'V' ||
                    source[p] == '=')) {
      p++;
      // After '=v' allow another whitespace skip in loose mode.
      if (loose) SkipWs(source, len, &p);
    }
  }

  // MAJOR.
  size_t start = p;
  while (p < len && IsAsciiDigit(source[p])) p++;
  if (p == start) return false;
  if (!ParseNumericIdent(source + start, p - start, &out->major)) {
    return false;
  }
  if (p >= len || source[p] != '.') return false;
  p++;

  // MINOR.
  start = p;
  while (p < len && IsAsciiDigit(source[p])) p++;
  if (p == start) return false;
  if (!ParseNumericIdent(source + start, p - start, &out->minor)) {
    return false;
  }
  if (p >= len || source[p] != '.') return false;
  p++;

  // PATCH.
  start = p;
  while (p < len && IsAsciiDigit(source[p])) p++;
  if (p == start) return false;
  if (!ParseNumericIdent(source + start, p - start, &out->patch)) {
    return false;
  }

  // Optional prerelease.
  if (p < len && source[p] == '-') {
    p++;
    out->prerelease = source + p;
    size_t pre_start = p;
    // Identifiers separated by '.': consume valid id-chars and dots
    // until '+' or end.
    while (p < len && source[p] != '+') {
      if (IsIdentifierChar(source[p]) || source[p] == '.') {
        p++;
      } else {
        return false;
      }
    }
    out->prerelease_len = p - pre_start;
    if (out->prerelease_len == 0) return false;
    // Validate per identifier: numerics no leading zeros (we handle
    // that during compare via ParseNumericIdent's strict mode).
    // No empty identifiers: ".foo" or "foo." or "a..b" are invalid.
    if (out->prerelease[0] == '.' ||
        out->prerelease[out->prerelease_len - 1] == '.') {
      return false;
    }
    for (size_t i = 1; i < out->prerelease_len; ++i) {
      if (out->prerelease[i] == '.' && out->prerelease[i - 1] == '.') {
        return false;
      }
    }
  }

  // Optional build.
  if (p < len && source[p] == '+') {
    p++;
    out->build = source + p;
    size_t build_start = p;
    while (p < len) {
      if (IsIdentifierChar(source[p]) || source[p] == '.') {
        p++;
      } else {
        return false;
      }
    }
    out->build_len = p - build_start;
    if (out->build_len == 0) return false;
    if (out->build[0] == '.' ||
        out->build[out->build_len - 1] == '.') {
      return false;
    }
    for (size_t i = 1; i < out->build_len; ++i) {
      if (out->build[i] == '.' && out->build[i - 1] == '.') {
        return false;
      }
    }
  }

  if (loose) {
    SkipWs(source, len, &p);
  }
  if (p != len) return false;

  out->valid = true;
  return true;
}

int CompareSemVer(const SemVer& a, const SemVer& b) {
  if (a.major != b.major) return a.major < b.major ? -1 : 1;
  if (a.minor != b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch != b.patch) return a.patch < b.patch ? -1 : 1;
  return ComparePrerelease(a.prerelease, a.prerelease_len,
                           b.prerelease, b.prerelease_len);
}

namespace {

// Range-parser helpers.
// =====================
//
// The grammar (subset of npm semver, sufficient for npm/yarn/pnpm
// manifests):
//
//   range-set    := range ( '||' range )*
//   range        := simple ( ' '+ simple )* | hyphen
//   hyphen       := partial ' - ' partial
//   simple       := primitive | partial | tilde | caret
//   primitive    := ('<' | '>' | '>=' | '<=' | '=' | '!=') ' '* partial
//   tilde        := '~' partial
//   caret        := '^' partial
//   partial      := xr ('.' xr ('.' xr qualifier?)?)?
//   xr           := 'x' | 'X' | '*' | nr
//   qualifier    := ('-' pre)? ('+' build)?
//
// Each `simple` expands into one or more comparators. We collect
// comparators into "sets" (one per `range`); the disjunction is at
// the top level.

// Trim leading/trailing whitespace from a span; returns adjusted
// pointer + length.
inline void TrimWs(const char** s, size_t* len) {
  while (*len > 0 &&
         ((*s)[0] == ' ' || (*s)[0] == '\t' || (*s)[0] == '\r' ||
          (*s)[0] == '\n')) {
    (*s)++;
    (*len)--;
  }
  while (*len > 0 &&
         ((*s)[*len - 1] == ' ' || (*s)[*len - 1] == '\t' ||
          (*s)[*len - 1] == '\r' || (*s)[*len - 1] == '\n')) {
    (*len)--;
  }
}

// "Partial" version with x-range support. Components that are 'x',
// 'X', '*', or absent become kXAny.
constexpr uint64_t kXAny = static_cast<uint64_t>(-1);

struct Partial {
  uint64_t major = kXAny;
  uint64_t minor = kXAny;
  uint64_t patch = kXAny;
  // Prerelease span (offsets into the partial's source).
  const char* prerelease = nullptr;
  size_t prerelease_len = 0;
  // True if the user wrote any explicit major / minor / patch.
  bool has_major = false;
  bool has_minor = false;
  bool has_patch = false;
};

// Parse a partial "X[.Y[.Z[-pre]]]" with x-range support.
bool ParsePartial(const char* s, size_t len, Partial* out) {
  if (len == 0) {
    // Bare "*" or "" — treat as kXAny throughout.
    return true;
  }
  size_t p = 0;
  // Strip leading 'v' / '='.
  if (p < len && (s[p] == 'v' || s[p] == 'V' || s[p] == '=')) p++;

  // Parse component by component.
  for (int comp = 0; comp < 3; ++comp) {
    if (p >= len) break;
    if (s[p] == 'x' || s[p] == 'X' || s[p] == '*') {
      p++;
      // Component already kXAny by default; mark as "explicit" so
      // prerelease parsing works for "1.x.0" (uncommon but legal).
      if (comp == 0) out->has_major = true;
      else if (comp == 1) out->has_minor = true;
      else out->has_patch = true;
    } else if (IsAsciiDigit(s[p])) {
      size_t start = p;
      while (p < len && IsAsciiDigit(s[p])) p++;
      uint64_t v;
      if (!ParseNumericIdent(s + start, p - start, &v)) return false;
      if (comp == 0) {
        out->major = v;
        out->has_major = true;
      } else if (comp == 1) {
        out->minor = v;
        out->has_minor = true;
      } else {
        out->patch = v;
        out->has_patch = true;
      }
    } else {
      // Unexpected char — bail.
      return false;
    }
    if (p < len && s[p] == '.') {
      p++;
    } else {
      break;
    }
  }

  // Optional prerelease.
  if (p < len && s[p] == '-') {
    p++;
    out->prerelease = s + p;
    size_t pre_start = p;
    while (p < len && s[p] != '+') p++;
    out->prerelease_len = p - pre_start;
  }
  // Optional build (consumed but ignored).
  if (p < len && s[p] == '+') {
    p++;
    while (p < len) p++;
  }
  // If anything else trails, bail.
  return p == len;
}

// Build a SemVer from a Partial. x-components become 0; prerelease
// passes through. Used when expanding range comparators.
SemVer PartialToVersion(const Partial& pp) {
  SemVer v;
  v.major = pp.major == kXAny ? 0 : pp.major;
  v.minor = pp.minor == kXAny ? 0 : pp.minor;
  v.patch = pp.patch == kXAny ? 0 : pp.patch;
  v.prerelease = pp.prerelease;
  v.prerelease_len = pp.prerelease_len;
  v.valid = true;
  return v;
}

// Format a SemVer back into a "M.m.p[-pre]" string. Used for
// synthesized comparator versions (caret/tilde/hyphen expansions).
std::string FormatSemVer(const SemVer& v) {
  std::string out;
  out.reserve(32);
  out.append(std::to_string(v.major));
  out.push_back('.');
  out.append(std::to_string(v.minor));
  out.push_back('.');
  out.append(std::to_string(v.patch));
  if (v.prerelease_len > 0) {
    out.push_back('-');
    out.append(v.prerelease, v.prerelease_len);
  }
  return out;
}

// Produce a comparator from a synthesized version. We materialize
// the version string into the range's owned_strings, then re-parse
// from the materialized buffer so the comparator's prerelease
// pointer stays stable.
void EmitComparator(Range* range,
                    uint8_t op,
                    const SemVer& v,
                    std::vector<Comparator>* set) {
  Comparator c;
  c.op = op;
  range->owned_strings.push_back(FormatSemVer(v));
  const std::string& str = range->owned_strings.back();
  if (!ParseSemVer(str.data(), str.size(), false, &c.version)) {
    // Shouldn't happen — FormatSemVer produces well-formed output.
    return;
  }
  c.version_source = str.data();
  c.version_source_len = str.size();
  set->push_back(std::move(c));
}

// Expand a caret-range "^X.Y.Z" per npm semver semantics:
//   ^1.2.3 := >=1.2.3 <2.0.0
//   ^0.2.3 := >=0.2.3 <0.3.0
//   ^0.0.3 := >=0.0.3 <0.0.4
//   ^1.2.x := >=1.2.0 <2.0.0
//   ^0.0.x := >=0.0.0 <0.1.0
//   ^0.0   := >=0.0.0 <0.1.0
void ExpandCaret(Range* range, const Partial& p,
                 std::vector<Comparator>* set) {
  SemVer lo = PartialToVersion(p);
  SemVer hi;
  hi.valid = true;
  hi.prerelease = nullptr;
  hi.prerelease_len = 0;

  if (p.major != kXAny && p.major != 0) {
    hi.major = p.major + 1;
    hi.minor = 0;
    hi.patch = 0;
  } else if (p.minor != kXAny && p.minor != 0) {
    hi.major = lo.major;
    hi.minor = p.minor + 1;
    hi.patch = 0;
  } else if (p.patch != kXAny) {
    hi.major = lo.major;
    hi.minor = lo.minor;
    hi.patch = p.patch + 1;
  } else if (p.minor != kXAny) {
    // ^0.0.x form.
    hi.major = lo.major;
    hi.minor = lo.minor + 1;
    hi.patch = 0;
  } else {
    // Bare "^0" or "^*".
    hi.major = lo.major + 1;
    hi.minor = 0;
    hi.patch = 0;
  }
  EmitComparator(range, 4 /* gte */, lo, set);
  EmitComparator(range, 3 /* lt  */, hi, set);
}

void ExpandTilde(Range* range, const Partial& p,
                 std::vector<Comparator>* set) {
  // ~1.2.3 := >=1.2.3 <1.3.0
  // ~1.2   := >=1.2.0 <1.3.0
  // ~1     := >=1.0.0 <2.0.0
  SemVer lo = PartialToVersion(p);
  SemVer hi;
  hi.valid = true;
  if (p.has_minor) {
    hi.major = lo.major;
    hi.minor = lo.minor + 1;
    hi.patch = 0;
  } else if (p.has_major) {
    hi.major = lo.major + 1;
    hi.minor = 0;
    hi.patch = 0;
  } else {
    // Bare "~*" — caret-equivalent (any).
    hi.major = kXAny;
  }
  EmitComparator(range, 4, lo, set);
  if (hi.major != kXAny) {
    EmitComparator(range, 3, hi, set);
  }
}

void ExpandPartial(Range* range, const Partial& p,
                   std::vector<Comparator>* set) {
  // X.Y.Z      := =X.Y.Z
  // X.Y        := >=X.Y.0 <X.(Y+1).0
  // X          := >=X.0.0 <(X+1).0.0
  // *  / x.x.x := any (no comparator emitted)
  if (p.major == kXAny) {
    // Any.
    Comparator c;
    c.op = 6;
    set->push_back(std::move(c));
    return;
  }
  if (p.minor == kXAny) {
    SemVer lo;
    lo.valid = true;
    lo.major = p.major;
    SemVer hi;
    hi.valid = true;
    hi.major = p.major + 1;
    EmitComparator(range, 4, lo, set);
    EmitComparator(range, 3, hi, set);
    return;
  }
  if (p.patch == kXAny) {
    SemVer lo;
    lo.valid = true;
    lo.major = p.major;
    lo.minor = p.minor;
    SemVer hi;
    hi.valid = true;
    hi.major = p.major;
    hi.minor = p.minor + 1;
    EmitComparator(range, 4, lo, set);
    EmitComparator(range, 3, hi, set);
    return;
  }
  // Fully specified.
  SemVer eq = PartialToVersion(p);
  EmitComparator(range, 0, eq, set);
}

void ExpandHyphen(Range* range,
                  const Partial& low,
                  const Partial& high,
                  std::vector<Comparator>* set) {
  // 1.2.3 - 2.3.4 := >=1.2.3 <=2.3.4
  // 1.2 - 2.3.4   := >=1.2.0 <=2.3.4
  // 1.2.3 - 2.3   := >=1.2.3 <2.4.0
  // 1.2.3 - 2     := >=1.2.3 <3.0.0
  SemVer lo = PartialToVersion(low);
  EmitComparator(range, 4 /* gte */, lo, set);
  if (high.minor == kXAny) {
    SemVer hi;
    hi.valid = true;
    hi.major = high.major + 1;
    EmitComparator(range, 3 /* lt */, hi, set);
  } else if (high.patch == kXAny) {
    SemVer hi;
    hi.valid = true;
    hi.major = high.major;
    hi.minor = high.minor + 1;
    EmitComparator(range, 3, hi, set);
  } else {
    SemVer hi = PartialToVersion(high);
    EmitComparator(range, 5 /* lte */, hi, set);
  }
}

// Parse a single "simple" (one of: primitive, partial, tilde, caret).
// Returns the byte position past the simple, or 0 on failure.
size_t ParseSimple(Range* range, const char* s, size_t len,
                   std::vector<Comparator>* set) {
  size_t p = 0;
  // Whitespace.
  while (p < len && (s[p] == ' ' || s[p] == '\t')) p++;
  if (p >= len) return 0;

  // Detect primitive operator prefix.
  uint8_t op = 6;
  bool has_op = false;
  if (s[p] == '>') {
    p++;
    if (p < len && s[p] == '=') { op = 4; p++; }
    else { op = 2; }
    has_op = true;
  } else if (s[p] == '<') {
    p++;
    if (p < len && s[p] == '=') { op = 5; p++; }
    else { op = 3; }
    has_op = true;
  } else if (s[p] == '=') {
    p++;
    op = 0;
    has_op = true;
  } else if (p + 1 < len && s[p] == '!' && s[p + 1] == '=') {
    p += 2;
    op = 1;
    has_op = true;
  } else if (s[p] == '~') {
    p++;
    // Capture the partial that follows.
    size_t partial_start = p;
    while (p < len && s[p] != ' ' && s[p] != '\t' && s[p] != '|') p++;
    Partial pp;
    if (!ParsePartial(s + partial_start, p - partial_start, &pp)) return 0;
    ExpandTilde(range, pp, set);
    return p;
  } else if (s[p] == '^') {
    p++;
    size_t partial_start = p;
    while (p < len && s[p] != ' ' && s[p] != '\t' && s[p] != '|') p++;
    Partial pp;
    if (!ParsePartial(s + partial_start, p - partial_start, &pp)) return 0;
    ExpandCaret(range, pp, set);
    return p;
  }

  if (has_op) {
    while (p < len && (s[p] == ' ' || s[p] == '\t')) p++;
  }
  size_t partial_start = p;
  while (p < len && s[p] != ' ' && s[p] != '\t' && s[p] != '|') p++;
  if (p == partial_start) return 0;

  Partial pp;
  if (!ParsePartial(s + partial_start, p - partial_start, &pp)) return 0;
  if (!has_op) {
    ExpandPartial(range, pp, set);
  } else {
    SemVer v = PartialToVersion(pp);
    EmitComparator(range, op, v, set);
  }
  return p;
}

// Detect a hyphen "X - Y" range. Returns the position past the
// trailing partial on success (and emits comparators), or 0 if
// this segment isn't a hyphen range.
size_t TryHyphenRange(Range* range, const char* s, size_t len,
                      std::vector<Comparator>* set) {
  // Must contain " - " somewhere with a partial on each side.
  for (size_t i = 0; i + 2 < len; ++i) {
    if (s[i] == ' ' && s[i + 1] == '-' && s[i + 2] == ' ') {
      // Left partial: s[0..i].
      const char* left = s;
      size_t left_len = i;
      TrimWs(&left, &left_len);
      // Right partial: s[i+3..end-of-segment].
      size_t right_start = i + 3;
      size_t p = right_start;
      while (p < len && s[p] != '|') p++;
      const char* right = s + right_start;
      size_t right_len = p - right_start;
      TrimWs(&right, &right_len);

      Partial lo_p, hi_p;
      if (!ParsePartial(left, left_len, &lo_p)) return 0;
      if (!ParsePartial(right, right_len, &hi_p)) return 0;
      ExpandHyphen(range, lo_p, hi_p, set);
      return p;
    }
  }
  return 0;
}

}  // namespace

bool ParseRange(const char* source, size_t len, bool loose, Range* out) {
  if (out == nullptr) return false;
  if (source == nullptr || len == 0) {
    // Empty range == "any" — emit a single set with one any-comparator.
    Comparator c;
    out->sets.push_back({c});
    out->valid = true;
    return true;
  }

  size_t p = 0;
  while (p < len) {
    // Skip leading whitespace.
    while (p < len && (source[p] == ' ' || source[p] == '\t')) p++;
    if (p >= len) break;

    // Parse one set (sequence of simples joined by whitespace) up
    // to '||' or end.
    std::vector<Comparator> set;

    // Find where this set ends ('||' or end of input).
    size_t set_end = p;
    while (set_end + 1 < len) {
      if (source[set_end] == '|' && source[set_end + 1] == '|') break;
      set_end++;
    }
    if (set_end + 1 >= len) set_end = len;

    // Try hyphen first; if it matches, consume the whole segment.
    size_t hyphen_consumed =
        TryHyphenRange(out, source + p, set_end - p, &set);
    if (hyphen_consumed > 0) {
      p += hyphen_consumed;
    } else {
      // Otherwise parse simples until set_end.
      while (p < set_end) {
        while (p < set_end &&
               (source[p] == ' ' || source[p] == '\t')) p++;
        if (p >= set_end) break;
        size_t consumed = ParseSimple(out, source + p, set_end - p, &set);
        if (consumed == 0) {
          if (loose) {
            // In loose mode, skip to next whitespace or set boundary
            // and try again.
            while (p < set_end &&
                   source[p] != ' ' && source[p] != '\t') p++;
            continue;
          }
          return false;
        }
        p += consumed;
      }
    }
    out->sets.push_back(std::move(set));

    // Consume the '||' separator if present.
    if (p + 1 < len && source[p] == '|' && source[p + 1] == '|') {
      p += 2;
    } else if (p < len && source[p] == '|') {
      // Stray single '|' — treat as separator in loose mode, error
      // in strict.
      if (!loose) return false;
      p++;
    }
  }

  if (out->sets.empty()) {
    Comparator c;
    out->sets.push_back({c});
  }
  out->valid = true;
  return true;
}

namespace {

// Does a single comparator match?
bool ComparatorMatches(const Comparator& c, const SemVer& v) {
  if (c.op == 6) return true;  // any
  int cmp = CompareSemVer(v, c.version);
  switch (c.op) {
    case 0: return cmp == 0;
    case 1: return cmp != 0;
    case 2: return cmp > 0;
    case 3: return cmp < 0;
    case 4: return cmp >= 0;
    case 5: return cmp <= 0;
    default: return false;
  }
}

}  // namespace

bool RangeSatisfies(const SemVer& v, const Range& r,
                    bool include_prerelease) {
  if (!r.valid || r.sets.empty()) return false;
  for (const auto& set : r.sets) {
    bool all_match = true;
    bool any_prerelease_in_set = false;
    bool main_version_in_set = false;
    for (const auto& c : set) {
      if (!ComparatorMatches(c, v)) {
        all_match = false;
        break;
      }
      if (c.op != 6 && c.version.prerelease_len > 0) {
        any_prerelease_in_set = true;
        if (c.version.major == v.major && c.version.minor == v.minor &&
            c.version.patch == v.patch) {
          main_version_in_set = true;
        }
      }
    }
    if (!all_match) continue;

    // Spec § "Including Prerelease": a prerelease version matches a
    // range only if at least one comparator in the set has the same
    // [major, minor, patch] tuple AND has a prerelease tag — unless
    // include_prerelease is on.
    if (v.prerelease_len > 0 && !include_prerelease) {
      if (!main_version_in_set || !any_prerelease_in_set) continue;
    }
    return true;
  }
  return false;
}

}  // namespace versions
}  // namespace socketsecurity
}  // namespace node
