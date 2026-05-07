// node:smol-manifest V8 binding — exposes the native lockfile parsers
// to JS as `internalBinding('smol_manifest_native')`.
//
// Surface (single method):
//
//   parseLockfile(content: string, ecosystem: number, format: number)
//     -> ParsedLockfile | null
//
// Returns a frozen object matching socket-lib's ParsedLockfile shape:
//   { type: 'lockfile', lockVersion, ecosystem, packages: PackageRef[],
//     _index: Record<string, number | number[]> }
//
// On parse failure, throws a ManifestError-shaped Error with .code
// set to the stable error string (e.g. 'ERR_UNSUPPORTED').

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "v8.h"

#include "manifest.h"

#include <string>
#include <string_view>

namespace node {
namespace socketsecurity {
namespace manifest {

using v8::Array;
using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::FunctionCallbackInfo;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::Null;
using v8::Object;
using v8::String;
using v8::Value;

namespace {

// Materialize a v8::String into a std::string. Same shape used by
// versions_binding.cc.
std::string ToStdString(Isolate* isolate, Local<String> s) {
  size_t len = s->Utf8LengthV2(isolate);
  std::string buf;
  buf.resize(len);
  s->WriteUtf8V2(isolate, buf.data(), len,
                 v8::String::WriteFlags::kReplaceInvalidUtf8);
  return buf;
}

// Make a v8::String from a std::string_view.
Local<String> MakeStr(Isolate* isolate, std::string_view sv) {
  Local<String> result;
  if (!String::NewFromUtf8(isolate, sv.data(),
                           v8::NewStringType::kNormal,
                           static_cast<int>(sv.size()))
           .ToLocal(&result)) {
    return String::Empty(isolate);
  }
  return result;
}

// Set property + freeze. Wraps the verbose Set + IntegrityLevel chain
// so the construction code stays compact.
void SetProp(Isolate* isolate, Local<Context> context, Local<Object> obj,
             const char* name, Local<Value> value) {
  obj->Set(context, MakeStr(isolate, name), value).Check();
}

// Build a JS PackageRef (frozen) from the C++ struct.
Local<Object> BuildPackageRef(Isolate* isolate, Local<Context> context,
                              const PackageRef& ref, Ecosystem ecosystem) {
  Local<Object> obj = Object::New(isolate);
  SetProp(isolate, context, obj, "name", MakeStr(isolate, ref.name));
  SetProp(isolate, context, obj, "version", MakeStr(isolate, ref.version));
  if (!ref.resolved.empty()) {
    SetProp(isolate, context, obj, "resolved", MakeStr(isolate, ref.resolved));
  }
  if (!ref.integrity.empty()) {
    SetProp(isolate, context, obj, "integrity",
            MakeStr(isolate, ref.integrity));
  }
  const char* eco_str = ecosystem == Ecosystem::kCargo ? "cargo" : "npm";
  SetProp(isolate, context, obj, "ecosystem", MakeStr(isolate, eco_str));
  const char* dep_str = "prod";
  switch (ref.depType) {
    case DepType::kDev: dep_str = "dev"; break;
    case DepType::kOptional: dep_str = "optional"; break;
    case DepType::kPeer: dep_str = "peer"; break;
    case DepType::kProd: dep_str = "prod"; break;
  }
  SetProp(isolate, context, obj, "depType", MakeStr(isolate, dep_str));
  SetProp(isolate, context, obj, "isDev",
          Boolean::New(isolate, ref.isDev));
  SetProp(isolate, context, obj, "isOptional",
          Boolean::New(isolate, ref.isOptional));
  SetProp(isolate, context, obj, "isPeer",
          Boolean::New(isolate, ref.isPeer));
  SetProp(isolate, context, obj, "isBundled",
          Boolean::New(isolate, ref.isBundled));
  if (!ref.license.empty()) {
    SetProp(isolate, context, obj, "license", MakeStr(isolate, ref.license));
  }
  if (!ref.vcsUrl.empty()) {
    SetProp(isolate, context, obj, "vcsUrl", MakeStr(isolate, ref.vcsUrl));
  }
  if (!ref.vcsCommit.empty()) {
    SetProp(isolate, context, obj, "vcsCommit",
            MakeStr(isolate, ref.vcsCommit));
  }
  // dependencies array.
  Local<Array> deps = Array::New(isolate, static_cast<int>(
                                              ref.dependencies.size()));
  for (uint32_t i = 0; i < ref.dependencies.size(); ++i) {
    deps->Set(context, i, MakeStr(isolate, ref.dependencies[i])).Check();
  }
  SetProp(isolate, context, obj, "dependencies", deps);
  obj->SetIntegrityLevel(context, v8::IntegrityLevel::kFrozen).Check();
  return obj;
}

// Build the JS ParsedLockfile from the C++ struct.
Local<Object> BuildParsedLockfile(Isolate* isolate, Local<Context> context,
                                  const ParsedLockfile& r) {
  Local<Object> obj = Object::New(isolate);
  SetProp(isolate, context, obj, "type", MakeStr(isolate, "lockfile"));
  SetProp(isolate, context, obj, "lockVersion",
          MakeStr(isolate, r.lockVersion));
  const char* eco_str = r.ecosystem == Ecosystem::kCargo ? "cargo" : "npm";
  SetProp(isolate, context, obj, "ecosystem", MakeStr(isolate, eco_str));

  // packages array.
  Local<Array> packages = Array::New(isolate,
                                     static_cast<int>(r.packages.size()));
  for (uint32_t i = 0; i < r.packages.size(); ++i) {
    packages->Set(context, i,
                  BuildPackageRef(isolate, context, r.packages[i],
                                  r.ecosystem))
        .Check();
  }
  packages->SetIntegrityLevel(context, v8::IntegrityLevel::kFrozen).Check();
  SetProp(isolate, context, obj, "packages", packages);

  // _index object.
  Local<Object> index = Object::New(isolate);
  for (const auto& [k, v] : r.index) {
    Local<Value> jv;
    if (std::holds_alternative<uint32_t>(v)) {
      jv = Integer::NewFromUnsigned(isolate, std::get<uint32_t>(v));
    } else {
      const auto& vec = std::get<std::vector<uint32_t>>(v);
      Local<Array> arr = Array::New(isolate, static_cast<int>(vec.size()));
      for (uint32_t i = 0; i < vec.size(); ++i) {
        arr->Set(context, i,
                 Integer::NewFromUnsigned(isolate, vec[i]))
            .Check();
      }
      jv = arr;
    }
    index->Set(context, MakeStr(isolate, k), jv).Check();
  }
  SetProp(isolate, context, obj, "_index", index);

  obj->SetIntegrityLevel(context, v8::IntegrityLevel::kFrozen).Check();
  return obj;
}

void ThrowError(Isolate* isolate, const ParseError& err) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> e = Exception::Error(MakeStr(isolate, err.message))
                        ->ToObject(context)
                        .ToLocalChecked();
  e->Set(context, MakeStr(isolate, "code"), MakeStr(isolate, err.code))
      .Check();
  isolate->ThrowException(e);
}

// parseLockfile(content, ecosystem, format) → ParsedLockfile
void ParseLockfileJs(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 3 || !args[0]->IsString() ||
      !args[1]->IsInt32() || !args[2]->IsInt32()) {
    ParseError err;
    err.message = "parseLockfile(string, int, int) — bad args";
    err.code = "ERR_INVALID_ARG_TYPE";
    ThrowError(isolate, err);
    return;
  }

  std::string content =
      ToStdString(isolate, args[0].As<String>());
  int32_t eco_int = args[1].As<Integer>()->Value();
  int32_t fmt_int = args[2].As<Integer>()->Value();

  if (eco_int < 0 || eco_int > 1 || fmt_int < 0 || fmt_int > 3) {
    ParseError err;
    err.message = "parseLockfile: ecosystem/format out of range";
    err.code = "ERR_OUT_OF_RANGE";
    ThrowError(isolate, err);
    return;
  }
  Ecosystem ecosystem = static_cast<Ecosystem>(eco_int);
  LockFormat format = static_cast<LockFormat>(fmt_int);

  ParseContext ctx;
  ParsedLockfile r;
  ParseError err;
  bool ok = ParseLockfile(content, ecosystem, format, &ctx, &r, &err);
  if (!ok) {
    ThrowError(isolate, err);
    return;
  }

  args.GetReturnValue().Set(BuildParsedLockfile(isolate, context, r));
}

}  // namespace

void Initialize(Local<Object> target, Local<Value> /* unused */,
                Local<Context> context, void* /* priv */) {
  SetMethod(context, target, "parseLockfile", ParseLockfileJs);
}

void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(ParseLockfileJs);
}

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_manifest_native, node::socketsecurity::manifest::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_manifest_native,
    node::socketsecurity::manifest::RegisterExternalReferences)
