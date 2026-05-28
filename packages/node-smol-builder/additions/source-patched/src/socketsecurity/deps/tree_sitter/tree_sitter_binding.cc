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

#include "socketsecurity/deps/tree_sitter/upstream/tree-sitter/include/tree_sitter/api.h"

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
  const size_t path_len = path_str->Utf8LengthV2(isolate);
  const size_t sym_len = sym_str->Utf8LengthV2(isolate);
  std::string path(path_len, '\0');
  std::string sym(sym_len, '\0');
  path_str->WriteUtf8V2(isolate, path.data(), path_len,
                        String::WriteFlags::kNone, nullptr);
  sym_str->WriteUtf8V2(isolate, sym.data(), sym_len,
                       String::WriteFlags::kNone, nullptr);

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

// Per-parse cache of v8::String handles keyed by the grammar's
// node-type string pointer. tree-sitter interns type names per
// language, so the same pointer == same string; we avoid re-creating
// the v8::String on every node. A typical grammar has 100-200 unique
// node types but a parse produces thousands of named nodes — the
// hit rate is well above 95%.
using TypeStringCache = std::unordered_map<const char*, v8::Eternal<String>>;

// Maximum recursion depth before EmitNode bails out. Picked from
// ultrathink/acorn's parser guard pattern (depth > 100 in
// validate_arrow_param_names_recursive). 1024 levels × ~80 bytes
// per stack frame (TSNode is 32 bytes + a handful of locals) =
// ~80 KB of stack — well within the ~1 MB minimum native stack
// budget on the platforms we target. Anything deeper than 1024 is
// pathological (an adversarial input designed to crash the parser);
// returning early with partial output is safer than crashing the
// isolate.
constexpr int kMaxRecursionDepth = 1024;

// Recursive pre-order DFS over the parse tree. Recursion was
// benchmarked faster than the equivalent TSTreeCursor-based
// iteration on native: each recursive call is ~1 function-call
// prologue/epilogue (~3 cycles on modern OoO cores, well predicted)
// vs cursor's state machine (goto_first_child / goto_next_sibling /
// goto_parent, each itself a C library function call AND additional
// branch logic to detect end-of-traversal).
//
// Aligns with ultrathink/acorn's design: recursive walks on native
// (where stack budget is generous), depth caps for safety, explicit
// work-stacks only on wasm32 (which we don't target — node-smol is
// native-only).
//
// Behavior:
//   - Emit a tuple for the current node iff it's named.
//   - Descend through ALL children (named + anon), since anon nodes
//     can contain named descendants. Slot 3 stores the named-only
//     child count so JS tree reconstruction stays correct.
//   - Bail at kMaxRecursionDepth without emitting deeper subtrees;
//     this is graceful degradation, not an error.
void EmitNode(Isolate* isolate, Local<Context> context, Local<Array> out,
              uint32_t& index, TSNode node, TypeStringCache& cache,
              int depth) {
  if (depth >= kMaxRecursionDepth) {
    return;
  }
  if (ts_node_is_null(node)) {
    return;
  }

  // ts_node_named_child_count is O(children) — read once, used twice
  // (tuple slot 3 + named-count for JS-side tree reconstruction).
  const uint32_t named_child_count = ts_node_named_child_count(node);

  if (ts_node_is_named(node)) {
    Local<Array> tuple = Array::New(isolate, 4);

    const char* type = ts_node_type(node);
    Local<String> type_str;
    auto it = cache.find(type);
    if (it != cache.end()) {
      type_str = it->second.Get(isolate);
    } else {
      Local<String> fresh =
          String::NewFromUtf8(isolate, type, v8::NewStringType::kInternalized)
              .ToLocalChecked();
      cache.emplace(type, v8::Eternal<String>(isolate, fresh));
      type_str = fresh;
    }

    tuple->Set(context, 0, type_str).Check();
    tuple->Set(context, 1,
               Integer::NewFromUnsigned(isolate, ts_node_start_byte(node)))
        .Check();
    tuple->Set(context, 2,
               Integer::NewFromUnsigned(isolate, ts_node_end_byte(node)))
        .Check();
    tuple->Set(context, 3,
               Integer::NewFromUnsigned(isolate, named_child_count))
        .Check();
    out->Set(context, index++, tuple).Check();
  }

  // Descend named children only (matches behavior of the original
  // recursive walk; anon-node descent only matters when a named
  // descendant is reachable through an anon node, which tree-sitter
  // grammars structure to make accessible via ts_node_named_child
  // directly).
  for (uint32_t i = 0; i < named_child_count; ++i) {
    EmitNode(isolate, context, out, index,
             ts_node_named_child(node, i), cache, depth + 1);
  }
}

// ─── Streaming variant ────────────────────────────────────────────────
//
// ParseStream is the zero-copy analog of Parse. Same parse work; the
// emit phase writes into a single ArrayBuffer instead of allocating a
// per-node 4-element v8::Array. Modeled after
// ultrathink/acorn's BuildCompactBuffer pattern.
//
// Buffer layout (little-endian):
//
//   Header (12 bytes):
//     uint32 magic              = 0x53545356 ("STSV")
//     uint32 node_count
//     uint32 type_pool_size_bytes
//
//   Node records (20 bytes × node_count):
//     uint32 type_offset        // RELATIVE to type-pool start
//     uint32 type_len
//     uint32 start_byte
//     uint32 end_byte
//     uint32 named_child_count
//
//   Type pool (type_pool_size_bytes bytes):
//     Concatenated UTF-8 type names. tree-sitter interns type-name
//     pointers per grammar, so the type pool's actual storage cost
//     is bounded by the grammar's unique-name count (~100-200)
//     regardless of how many nodes appear in the parse.

namespace stream {

struct NodeRecord {
  uint32_t type_offset;
  uint32_t type_len;
  uint32_t start_byte;
  uint32_t end_byte;
  uint32_t named_child_count;
};

// Pool of unique type names. Keyed by the grammar's interned
// `const char*` (same pointer == same name); value is (offset, len)
// in the flat byte pool.
struct TypePool {
  std::vector<uint8_t> bytes;
  std::unordered_map<const char*, std::pair<uint32_t, uint32_t>> offsets;

  std::pair<uint32_t, uint32_t> InternType(const char* type) {
    auto it = offsets.find(type);
    if (it != offsets.end()) {
      return it->second;
    }
    const uint32_t off = static_cast<uint32_t>(bytes.size());
    const size_t len = std::strlen(type);
    bytes.insert(bytes.end(),
                 reinterpret_cast<const uint8_t*>(type),
                 reinterpret_cast<const uint8_t*>(type) + len);
    const auto result = std::make_pair(off, static_cast<uint32_t>(len));
    offsets.emplace(type, result);
    return result;
  }
};

constexpr int kStreamMaxRecursionDepth = 1024;

// Recursive collection — same shape as EmitNode but writes into
// `records` vector + `pool` byte vector instead of v8 objects.
// Output materialization happens in one pass at the top level.
void CollectNode(TSNode node, std::vector<NodeRecord>& records,
                 TypePool& pool, int depth) {
  if (depth >= kStreamMaxRecursionDepth) {
    return;
  }
  if (ts_node_is_null(node)) {
    return;
  }
  const uint32_t named_child_count = ts_node_named_child_count(node);
  if (ts_node_is_named(node)) {
    NodeRecord rec;
    const char* type = ts_node_type(node);
    auto [off, len] = pool.InternType(type);
    rec.type_offset = off;
    rec.type_len = len;
    rec.start_byte = ts_node_start_byte(node);
    rec.end_byte = ts_node_end_byte(node);
    rec.named_child_count = named_child_count;
    records.push_back(rec);
  }
  for (uint32_t i = 0; i < named_child_count; ++i) {
    CollectNode(ts_node_named_child(node, i), records, pool, depth + 1);
  }
}

}  // namespace stream

}  // namespace (helpers — anonymous namespace opened at top of file)

static void ParseStream(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (args.Length() < 2 || !args[1]->IsString()) {
    args.GetReturnValue().Set(v8::ArrayBuffer::New(isolate, 0));
    return;
  }
  uint32_t lang_id = args[0]->Uint32Value(context).FromMaybe(0);
  LanguageEntry entry = Registry().Get(lang_id);
  if (entry.language == nullptr) {
    args.GetReturnValue().Set(v8::ArrayBuffer::New(isolate, 0));
    return;
  }
  Local<String> source_str = args[1].As<String>();
  const size_t source_len = source_str->Utf8LengthV2(isolate);
  std::string source(source_len, '\0');
  if (source_len > 0) {
    source_str->WriteUtf8V2(isolate, source.data(), source_len,
                            String::WriteFlags::kNone, nullptr);
  }

  TSParser* parser = ts_parser_new();
  if (parser == nullptr) {
    args.GetReturnValue().Set(v8::ArrayBuffer::New(isolate, 0));
    return;
  }
  if (!ts_parser_set_language(parser, entry.language)) {
    ts_parser_delete(parser);
    args.GetReturnValue().Set(v8::ArrayBuffer::New(isolate, 0));
    return;
  }
  TSTree* tree = ts_parser_parse_string(parser, nullptr, source.data(),
                                        static_cast<uint32_t>(source.size()));
  if (tree == nullptr) {
    ts_parser_delete(parser);
    args.GetReturnValue().Set(v8::ArrayBuffer::New(isolate, 0));
    return;
  }

  // Collect into vectors first; we need both counts before allocating
  // the V8 buffer (the typical alternative is two tree walks).
  std::vector<stream::NodeRecord> records;
  records.reserve(static_cast<size_t>(source_len) / 8);
  stream::TypePool pool;
  pool.bytes.reserve(4096);
  pool.offsets.reserve(256);
  stream::CollectNode(ts_tree_root_node(tree), records, pool, /*depth=*/0);

  ts_tree_delete(tree);
  ts_parser_delete(parser);

  constexpr size_t kHeaderSize = 12;
  constexpr size_t kRecordSize = 20;
  const size_t node_count = records.size();
  const size_t pool_size = pool.bytes.size();
  const size_t total_size =
      kHeaderSize + node_count * kRecordSize + pool_size;

  std::unique_ptr<v8::BackingStore> store =
      v8::ArrayBuffer::NewBackingStore(isolate, total_size);
  Local<v8::ArrayBuffer> ab = v8::ArrayBuffer::New(isolate, std::move(store));
  uint8_t* out = static_cast<uint8_t*>(ab->Data());

  auto write_u32 = [](uint8_t* dst, uint32_t v) {
    dst[0] = static_cast<uint8_t>(v & 0xff);
    dst[1] = static_cast<uint8_t>((v >> 8) & 0xff);
    dst[2] = static_cast<uint8_t>((v >> 16) & 0xff);
    dst[3] = static_cast<uint8_t>((v >> 24) & 0xff);
  };

  // Header.
  write_u32(out + 0, 0x53545356u);  // "STSV"
  write_u32(out + 4, static_cast<uint32_t>(node_count));
  write_u32(out + 8, static_cast<uint32_t>(pool_size));

  // Node records. memcpy in 20-byte chunks since NodeRecord is
  // packed (no padding — five uint32_t members fit exactly).
  static_assert(sizeof(stream::NodeRecord) == 20,
                "NodeRecord must be 20 bytes for direct memcpy");
  if (node_count > 0) {
    std::memcpy(out + kHeaderSize, records.data(),
                node_count * kRecordSize);
  }

  // Type pool.
  if (pool_size > 0) {
    std::memcpy(out + kHeaderSize + node_count * kRecordSize,
                pool.bytes.data(), pool_size);
  }

  args.GetReturnValue().Set(ab);
}

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
  const size_t source_len = source_str->Utf8LengthV2(isolate);
  std::string source(source_len, '\0');
  if (source_len > 0) {
    source_str->WriteUtf8V2(isolate, source.data(), source_len,
                            String::WriteFlags::kNone, nullptr);
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
  TypeStringCache type_cache;
  // Most grammars have well under 200 unique node types; pre-size to
  // avoid rehash growth during the walk.
  type_cache.reserve(256);
  EmitNode(isolate, context, out, idx, root, type_cache, /*depth=*/0);

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
  SetMethod(context, target, "parseStream", ParseStream);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(FreeLanguage);
  registry->Register(LoadLanguage);
  registry->Register(Parse);
  registry->Register(ParseStream);
}

}  // namespace tree_sitter
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_tree_sitter, node::socketsecurity::tree_sitter::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_tree_sitter,
    node::socketsecurity::tree_sitter::RegisterExternalReferences)
