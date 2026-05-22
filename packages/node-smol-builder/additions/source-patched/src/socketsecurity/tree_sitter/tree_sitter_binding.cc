// node:smol-tree-sitter binding.
//
// Wraps tree-sitter/tree-sitter (C, MIT). The C library has three core
// types we expose:
//
//   - TSParser:   stateful parser (per-language).
//   - TSLanguage: opaque language descriptor (loaded from a .dylib /
//                 .so / .dll built from a tree-sitter grammar repo).
//   - TSTree:     the parsed concrete syntax tree.
//   - TSNode:     a position within a TSTree (lightweight handle).
//
// Surface:
//
//   loadLanguage(path, symbol) -> uint32_t (handle) | 0 (failure)
//     dlopens `path` and resolves `symbol` (typically
//     `tree_sitter_<lang>`) as a `TSLanguage* (*)(void)` factory.
//     Returns an opaque handle the JS layer carries around.
//
//   freeLanguage(handle): release the dlopen handle.
//
//   parse(languageHandle, source) -> Array
//     Parses `source` with the language identified by handle. Returns
//     a flat array of [type_name, start_byte, end_byte, child_count]
//     tuples in pre-order (depth-first traversal). The JS layer
//     reconstructs the tree from byte-offset spans.
//
// We deliberately don't expose the full TSNode walk surface — for a
// syntax-highlighting consumer, the byte-offset + type-name stream is
// sufficient (highlight queries are a separate next-step binding).
//
// dlopen handles live in a process-wide map keyed by uint32_t. Same
// handle-registry pattern as the mouse parser / renderer / yoga
// bindings in tui_binding.cc.

#include "socketsecurity/tree_sitter/tree-sitter/include/tree_sitter/api.h"

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "v8.h"

#include <dlfcn.h>

#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace node {
namespace socketsecurity {
namespace tree_sitter {

using v8::Array;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::Object;
using v8::String;
using v8::Value;

namespace {

struct LanguageEntry {
  void* dlhandle;
  const TSLanguage* language;
};

class LanguageRegistry {
 public:
  uint32_t Add(LanguageEntry e) {
    std::lock_guard<std::mutex> lock(mu_);
    const uint32_t id = next_id_++;
    map_[id] = e;
    return id;
  }

  LanguageEntry Get(uint32_t id) {
    std::lock_guard<std::mutex> lock(mu_);
    auto it = map_.find(id);
    if (it == map_.end()) {
      return {nullptr, nullptr};
    }
    return it->second;
  }

  void Remove(uint32_t id) {
    std::lock_guard<std::mutex> lock(mu_);
    auto it = map_.find(id);
    if (it == map_.end()) {
      return;
    }
    if (it->second.dlhandle != nullptr) {
      dlclose(it->second.dlhandle);
    }
    map_.erase(it);
  }

 private:
  std::mutex mu_;
  std::unordered_map<uint32_t, LanguageEntry> map_;
  uint32_t next_id_ = 1;
};

LanguageRegistry& Registry() {
  static LanguageRegistry r;
  return r;
}

}  // namespace

static void LoadLanguage(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 2 || !args[0]->IsString() || !args[1]->IsString()) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  Local<String> path_str = args[0].As<String>();
  Local<String> sym_str = args[1].As<String>();
  const int path_len = path_str->Utf8Length(isolate);
  const int sym_len = sym_str->Utf8Length(isolate);
  std::string path(static_cast<size_t>(path_len), '\0');
  std::string sym(static_cast<size_t>(sym_len), '\0');
  path_str->WriteUtf8(isolate, path.data(), path_len, nullptr,
                      String::NO_NULL_TERMINATION);
  sym_str->WriteUtf8(isolate, sym.data(), sym_len, nullptr,
                     String::NO_NULL_TERMINATION);

  void* handle = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (handle == nullptr) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  using FactoryFn = const TSLanguage* (*)(void);
  // Suppress -Wpedantic for dlsym -> function pointer cast (POSIX-
  // ordained pattern, not actually undefined on any platform we
  // target).
  void* raw = dlsym(handle, sym.c_str());
  if (raw == nullptr) {
    dlclose(handle);
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  FactoryFn factory;
  std::memcpy(&factory, &raw, sizeof(factory));
  const TSLanguage* lang = factory();
  if (lang == nullptr) {
    dlclose(handle);
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  const uint32_t id = Registry().Add({handle, lang});
  args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, id));
}

static void FreeLanguage(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  Registry().Remove(id);
}

namespace {

// Pre-order DFS. Appends 4-element tuples [type_name, start_byte,
// end_byte, child_count] for every named node in the tree to `out`.
void EmitNode(Isolate* isolate, Local<Context> context, Local<Array> out,
              uint32_t& index, TSNode node) {
  if (ts_node_is_null(node)) {
    return;
  }
  // Only emit named nodes (the anon punctuation nodes blow up the
  // output without adding value for highlighters).
  const bool is_named = ts_node_is_named(node);

  if (is_named) {
    Local<Array> tuple = Array::New(isolate, 4);
    const char* type = ts_node_type(node);
    MaybeLocal<String> type_str_maybe =
        String::NewFromUtf8(isolate, type, v8::NewStringType::kNormal);
    Local<String> type_str;
    if (type_str_maybe.ToLocal(&type_str)) {
      tuple->Set(context, 0, type_str).Check();
    } else {
      tuple->Set(context, 0, v8::Undefined(isolate)).Check();
    }
    tuple->Set(context, 1,
               Integer::NewFromUnsigned(isolate, ts_node_start_byte(node)))
        .Check();
    tuple->Set(context, 2,
               Integer::NewFromUnsigned(isolate, ts_node_end_byte(node)))
        .Check();
    tuple->Set(context, 3,
               Integer::NewFromUnsigned(
                   isolate, ts_node_named_child_count(node)))
        .Check();
    out->Set(context, index++, tuple).Check();
  }

  const uint32_t n = ts_node_named_child_count(node);
  for (uint32_t i = 0; i < n; ++i) {
    EmitNode(isolate, context, out, index, ts_node_named_child(node, i));
  }
}

}  // namespace

static void Parse(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (args.Length() < 2 || !args[1]->IsString()) {
    args.GetReturnValue().Set(Array::New(isolate, 0));
    return;
  }
  uint32_t lang_id = args[0]->Uint32Value(context).FromMaybe(0);
  LanguageEntry entry = Registry().Get(lang_id);
  if (entry.language == nullptr) {
    args.GetReturnValue().Set(Array::New(isolate, 0));
    return;
  }

  Local<String> source_str = args[1].As<String>();
  const int source_len = source_str->Utf8Length(isolate);
  std::string source(static_cast<size_t>(source_len), '\0');
  if (source_len > 0) {
    source_str->WriteUtf8(isolate, source.data(), source_len, nullptr,
                          String::NO_NULL_TERMINATION);
  }

  TSParser* parser = ts_parser_new();
  if (parser == nullptr) {
    args.GetReturnValue().Set(Array::New(isolate, 0));
    return;
  }
  if (!ts_parser_set_language(parser, entry.language)) {
    ts_parser_delete(parser);
    args.GetReturnValue().Set(Array::New(isolate, 0));
    return;
  }
  TSTree* tree = ts_parser_parse_string(parser, nullptr, source.data(),
                                        static_cast<uint32_t>(source.size()));
  if (tree == nullptr) {
    ts_parser_delete(parser);
    args.GetReturnValue().Set(Array::New(isolate, 0));
    return;
  }

  TSNode root = ts_tree_root_node(tree);
  Local<Array> out = Array::New(isolate, 0);
  uint32_t idx = 0;
  EmitNode(isolate, context, out, idx, root);

  ts_tree_delete(tree);
  ts_parser_delete(parser);
  args.GetReturnValue().Set(out);
}

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  SetMethod(context, target, "freeLanguage", FreeLanguage);
  SetMethod(context, target, "loadLanguage", LoadLanguage);
  SetMethod(context, target, "parse", Parse);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(FreeLanguage);
  registry->Register(LoadLanguage);
  registry->Register(Parse);
}

}  // namespace tree_sitter
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_tree_sitter, node::socketsecurity::tree_sitter::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_tree_sitter,
    node::socketsecurity::tree_sitter::RegisterExternalReferences)
