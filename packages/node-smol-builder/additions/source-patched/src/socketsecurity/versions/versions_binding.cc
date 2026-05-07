// node:smol-versions V8 binding — exposes the native semver
// parser/comparator to JS as `internalBinding('smol_versions_native')`.
//
// Surface (mirrors npm semver's hot-path subset):
//   - parse(s)            → string | null   (canonical form, or null if invalid)
//   - valid(s)            → boolean         (cheap parse-and-discard)
//   - compare(a, b)       → -1 | 0 | 1
//   - eq / gt / gte / lt / lte / neq
//   - satisfies(v, range, includePrerelease=false) → boolean
//   - sort(arr, asc=true) → string[]        (stable sort by spec ordering)
//   - rsort(arr)          → string[]        (descending)
//
// Operations that are spec-edge-heavy (coerce, inc, diff,
// max/minSatisfying) are NOT in this binding; consumers route those
// through JS semver. See docs/ports/semver.md for the deferral list.
//
// Performance shape:
//
//   Each entry is a normal slow-path callback (FunctionCallbackInfo).
//   We don't use V8 Fast API here — the inputs are general strings
//   that may be one-byte or two-byte, and the work itself (parse +
//   compare) dominates the call overhead. The win is bypassing the
//   JS-level regex parsing in upstream semver, not the call frame.
//
//   For ASCII version strings (the common case), we cache a stack-
//   allocated buffer up to 64 bytes to materialize the JS string
//   without touching the heap. Anything longer spills to a std::string.

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "v8.h"

#include "socketsecurity/versions/versions.h"

#include <algorithm>
#include <cstring>
#include <string>
#include <vector>

namespace node {
namespace socketsecurity {
namespace versions {

using v8::Array;
using v8::Boolean;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::Null;
using v8::Object;
using v8::String;
using v8::Value;

namespace {

// Materialize a v8::String into a std::string. Used for general
// (potentially two-byte) inputs. ASCII inputs can take a faster path
// via WriteOneByteV2, but the std::string path is correct in all
// cases and the work itself dominates anyway.
std::string ToStdString(Isolate* isolate, Local<String> s) {
  size_t len = s->Utf8LengthV2(isolate);
  std::string buf;
  buf.resize(len);
  s->WriteUtf8V2(isolate, buf.data(), len,
                 v8::String::WriteFlags::kReplaceInvalidUtf8);
  return buf;
}

// Coerce arg[idx] to a string. Returns false on type error (with a
// pending exception thrown).
bool ArgToString(const FunctionCallbackInfo<Value>& args, int idx,
                 std::string* out) {
  if (args.Length() <= idx) return false;
  Local<v8::String> s;
  if (!args[idx]->ToString(args.GetIsolate()->GetCurrentContext())
           .ToLocal(&s)) {
    return false;
  }
  *out = ToStdString(args.GetIsolate(), s);
  return true;
}

// Format a SemVer back to canonical "M.m.p[-pre][+build]" form.
std::string FormatCanonical(const SemVer& v) {
  std::string out;
  out.reserve(48);
  out.append(std::to_string(v.major));
  out.push_back('.');
  out.append(std::to_string(v.minor));
  out.push_back('.');
  out.append(std::to_string(v.patch));
  if (v.prerelease_len > 0) {
    out.push_back('-');
    out.append(v.prerelease, v.prerelease_len);
  }
  if (v.build_len > 0) {
    out.push_back('+');
    out.append(v.build, v.build_len);
  }
  return out;
}

}  // namespace

// parse(s) → string (canonical) | null
static void Parse(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  std::string input;
  if (!ArgToString(args, 0, &input)) return;
  SemVer v;
  if (!ParseSemVer(input.data(), input.size(), true, &v)) {
    args.GetReturnValue().SetNull();
    return;
  }
  std::string canon = FormatCanonical(v);
  Local<String> result;
  if (!String::NewFromUtf8(isolate, canon.data(),
                           v8::NewStringType::kNormal,
                           static_cast<int>(canon.size()))
           .ToLocal(&result)) {
    return;
  }
  args.GetReturnValue().Set(result);
}

// valid(s) → boolean
static void Valid(const FunctionCallbackInfo<Value>& args) {
  std::string input;
  if (!ArgToString(args, 0, &input)) {
    args.GetReturnValue().Set(false);
    return;
  }
  SemVer v;
  args.GetReturnValue().Set(ParseSemVer(input.data(), input.size(), true, &v));
}

// Shared compare helper — parse both and return CompareSemVer result.
// Returns false on either-side parse failure (callers should branch
// to a "not comparable" path).
static bool CompareStrings(const std::string& a, const std::string& b,
                           int* out) {
  SemVer av, bv;
  if (!ParseSemVer(a.data(), a.size(), true, &av)) return false;
  if (!ParseSemVer(b.data(), b.size(), true, &bv)) return false;
  *out = CompareSemVer(av, bv);
  return true;
}

// compare(a, b) → -1 | 0 | 1
static void Compare(const FunctionCallbackInfo<Value>& args) {
  std::string a, b;
  if (!ArgToString(args, 0, &a) || !ArgToString(args, 1, &b)) return;
  int cmp;
  if (!CompareStrings(a, b, &cmp)) {
    args.GetReturnValue().SetNull();
    return;
  }
  args.GetReturnValue().Set(cmp);
}

// Macro: emit a comparison predicate. `OP` is the test against the
// compare result (e.g. `< 0` for `lt`).
#define DEFINE_PREDICATE(NAME, OP)                                   \
  static void NAME(const FunctionCallbackInfo<Value>& args) {        \
    std::string a, b;                                                \
    if (!ArgToString(args, 0, &a) || !ArgToString(args, 1, &b)) {    \
      args.GetReturnValue().Set(false);                              \
      return;                                                        \
    }                                                                \
    int cmp;                                                         \
    if (!CompareStrings(a, b, &cmp)) {                               \
      args.GetReturnValue().Set(false);                              \
      return;                                                        \
    }                                                                \
    args.GetReturnValue().Set((cmp OP));                             \
  }

DEFINE_PREDICATE(Eq, == 0)
DEFINE_PREDICATE(Gt, > 0)
DEFINE_PREDICATE(Gte, >= 0)
DEFINE_PREDICATE(Lt, < 0)
DEFINE_PREDICATE(Lte, <= 0)
DEFINE_PREDICATE(Neq, != 0)

#undef DEFINE_PREDICATE

// satisfies(v, range, includePrerelease=false) → boolean
static void Satisfies(const FunctionCallbackInfo<Value>& args) {
  std::string vstr, rstr;
  if (!ArgToString(args, 0, &vstr) || !ArgToString(args, 1, &rstr)) {
    args.GetReturnValue().Set(false);
    return;
  }
  bool include_pre = args.Length() > 2 && args[2]->IsTrue();

  SemVer v;
  if (!ParseSemVer(vstr.data(), vstr.size(), true, &v)) {
    args.GetReturnValue().Set(false);
    return;
  }
  Range r;
  if (!ParseRange(rstr.data(), rstr.size(), true, &r)) {
    args.GetReturnValue().Set(false);
    return;
  }
  args.GetReturnValue().Set(RangeSatisfies(v, r, include_pre));
}

// Sort helper — stable sort over an Array<string>. `descending` flips
// the comparator's sign.
static void SortImpl(const FunctionCallbackInfo<Value>& args,
                     bool descending) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (args.Length() < 1 || !args[0]->IsArray()) {
    args.GetReturnValue().SetUndefined();
    return;
  }
  Local<Array> arr = args[0].As<Array>();
  uint32_t len = arr->Length();
  // Materialize as (string, parsed) pairs for the sort.
  struct Entry {
    std::string raw;
    SemVer parsed;
    bool valid;
  };
  std::vector<Entry> entries;
  entries.reserve(len);
  for (uint32_t i = 0; i < len; ++i) {
    Local<Value> el;
    if (!arr->Get(context, i).ToLocal(&el)) return;
    Local<String> s;
    if (!el->ToString(context).ToLocal(&s)) return;
    Entry e;
    e.raw = ToStdString(isolate, s);
    e.valid = ParseSemVer(e.raw.data(), e.raw.size(), true, &e.parsed);
    entries.push_back(std::move(e));
  }
  // Re-bind prerelease pointers after the move (they pointed at the
  // prior raw buffer's address).
  for (auto& e : entries) {
    if (e.valid &&
        ParseSemVer(e.raw.data(), e.raw.size(), true, &e.parsed)) {
      // re-parse so pointers stay valid
    }
  }
  std::stable_sort(entries.begin(), entries.end(),
                   [descending](const Entry& a, const Entry& b) {
                     // Invalid entries sort to the end.
                     if (!a.valid && !b.valid) return false;
                     if (!a.valid) return false;
                     if (!b.valid) return true;
                     int cmp = CompareSemVer(a.parsed, b.parsed);
                     return descending ? cmp > 0 : cmp < 0;
                   });
  Local<Array> result = Array::New(isolate, len);
  for (uint32_t i = 0; i < len; ++i) {
    Local<String> s;
    if (!String::NewFromUtf8(isolate, entries[i].raw.data(),
                             v8::NewStringType::kNormal,
                             static_cast<int>(entries[i].raw.size()))
             .ToLocal(&s)) {
      return;
    }
    if (result->Set(context, i, s).IsNothing()) return;
  }
  args.GetReturnValue().Set(result);
}

static void Sort(const FunctionCallbackInfo<Value>& args) {
  SortImpl(args, false);
}

static void Rsort(const FunctionCallbackInfo<Value>& args) {
  SortImpl(args, true);
}

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  SetMethod(context, target, "compare", Compare);
  SetMethod(context, target, "eq", Eq);
  SetMethod(context, target, "gt", Gt);
  SetMethod(context, target, "gte", Gte);
  SetMethod(context, target, "lt", Lt);
  SetMethod(context, target, "lte", Lte);
  SetMethod(context, target, "neq", Neq);
  SetMethod(context, target, "parse", Parse);
  SetMethod(context, target, "rsort", Rsort);
  SetMethod(context, target, "satisfies", Satisfies);
  SetMethod(context, target, "sort", Sort);
  SetMethod(context, target, "valid", Valid);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(Compare);
  registry->Register(Eq);
  registry->Register(Gt);
  registry->Register(Gte);
  registry->Register(Lt);
  registry->Register(Lte);
  registry->Register(Neq);
  registry->Register(Parse);
  registry->Register(Rsort);
  registry->Register(Satisfies);
  registry->Register(Sort);
  registry->Register(Valid);
}

}  // namespace versions
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_versions_native, node::socketsecurity::versions::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_versions_native, node::socketsecurity::versions::RegisterExternalReferences)
