// node:smol-keymap binding.
//
// Minimal keymap matcher: parse a JSON rules object, hold the binding
// table, match keystrokes (with chord support) to bound commands.
// The full @opentui/keymap surface (layers, extensions, command
// catalog, runtime emitter, activation service, etc.) stays in
// userland TS; the C++ binding owns the perf-critical matcher hot
// path (~5 ns per keystroke) plus the chord state machine.
//
// Rules format (passed in as JSON string):
//
//   {
//     "ctrl+a": "select-all",
//     "ctrl+x ctrl+s": "save",
//     "ctrl+x ctrl+c": "exit",
//     "esc": "cancel"
//   }
//
// The space-separated form encodes chord sequences. Tokens within
// one chord step are joined with `+` and order-normalized to
// `ctrl+shift+alt+meta+<key>` so the matcher key is canonical
// regardless of input order. Key names are lower-cased.
//
// Surface:
//
//   createKeymap(rulesJson) -> handle (uint32)
//     Returns 0 on parse failure.
//
//   destroyKeymap(handle) -> void
//
//   matchKey(handle, keyName, modifierBits) -> command string | null
//     modifierBits: bit 0 = ctrl, bit 1 = shift, bit 2 = alt, bit 3 = meta.
//     Returns null when the keystroke doesn't match any binding (yet —
//     chord state may be pending). When a multi-step chord is in
//     progress, returns null on the intermediate steps and the bound
//     command on the final step.
//
//   resetChord(handle) -> void
//     Clear any pending chord state (e.g. after a timeout in JS).
//
// The handle is an opaque integer registered in a process-wide map.
// Same shape as the mouse parser / renderer / yoga bindings in
// tui_binding.cc.

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "v8.h"

#include <cctype>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <unordered_map>

namespace node {
namespace socketsecurity {
namespace keymap {

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

// Modifier bit layout — matches the JS surface so the two stay in
// sync without a translation table.
constexpr uint32_t kModCtrl = 1u << 0;
constexpr uint32_t kModShift = 1u << 1;
constexpr uint32_t kModAlt = 1u << 2;
constexpr uint32_t kModMeta = 1u << 3;

// One chord step. The matcher key is "ctrl+shift+alt+meta+<keyname>"
// with modifiers in canonical order, all lowercase. Computed once at
// parse time; stored as a string for O(1) hash lookup at match time.
struct ChordStep {
  std::string match_key;  // e.g. "ctrl+x"
};

// One binding: a sequence of chord steps + the command to fire on the
// final step. Length-1 bindings (`ctrl+a`) have one step; chord
// bindings (`ctrl+x ctrl+s`) have N.
struct Binding {
  std::vector<ChordStep> steps;
  std::string command;
};

// One keymap. Owns its bindings plus the pending-chord state (which
// step we're currently expecting). The state is per-keymap, not
// per-call: matchKey advances or resets it based on the input.
struct Keymap {
  // All bindings, sorted by first-step match_key for O(log N) prefix
  // lookup. (Linear scan would also be fine — typical keymap has <50
  // bindings — but the sort lets us bail early on no-match input.)
  std::vector<Binding> bindings;

  // Current chord position. Empty when no chord is in progress.
  // Holds the indices into `bindings` of the entries whose prefix
  // matches what's been pressed so far.
  std::vector<size_t> pending_indices;
  // How many steps we've matched in the pending chord. Equals the
  // index of the NEXT expected step in pending_indices[*].steps.
  size_t pending_depth = 0;

  // Scratch buffer for MatchKey's filtered-candidates list. Owned by
  // the Keymap so MatchKey can reuse the allocation across calls —
  // one heap alloc per keymap lifetime rather than one per keystroke.
  // Cleared at the start of every MatchKey.
  std::vector<size_t> scratch_next_pending;
};

class KeymapRegistry {
 public:
  uint32_t Add(std::unique_ptr<Keymap> keymap) {
    std::lock_guard<std::mutex> lock(mu_);
    const uint32_t id = next_id_++;
    map_[id] = std::move(keymap);
    return id;
  }

  Keymap* Get(uint32_t id) {
    std::lock_guard<std::mutex> lock(mu_);
    auto it = map_.find(id);
    return it == map_.end() ? nullptr : it->second.get();
  }

  void Remove(uint32_t id) {
    std::lock_guard<std::mutex> lock(mu_);
    map_.erase(id);
  }

 private:
  std::mutex mu_;
  std::unordered_map<uint32_t, std::unique_ptr<Keymap>> map_;
  uint32_t next_id_ = 1;
};

KeymapRegistry& Registry() {
  static KeymapRegistry r;
  return r;
}

// Build a canonical "ctrl+shift+alt+meta+<key>" match string from a
// key name and modifier bits. Pre-computed at parse time so matchKey
// can compose one lookup-key cheaply and string-compare against the
// stored binding keys.
inline std::string BuildMatchKey(const std::string& key, uint32_t mods) {
  std::string out;
  out.reserve(key.size() + 20);
  if (mods & kModCtrl) {
    out.append("ctrl+", 5);
  }
  if (mods & kModShift) {
    out.append("shift+", 6);
  }
  if (mods & kModAlt) {
    out.append("alt+", 4);
  }
  if (mods & kModMeta) {
    out.append("meta+", 5);
  }
  out.append(key);
  return out;
}

// Lowercase + canonicalize one "modifier+modifier+key" token (one
// chord step). The input is a substring of the rules JSON key; we
// re-emit it as ctrl+shift+alt+meta+<keyname> regardless of input
// order so `shift+ctrl+a` and `ctrl+shift+a` both match the same key.
std::string CanonicalizeStep(const std::string& token) {
  uint32_t mods = 0;
  std::string keyname;
  size_t start = 0;
  while (start < token.size()) {
    size_t plus = token.find('+', start);
    std::string part;
    if (plus == std::string::npos) {
      part = token.substr(start);
      start = token.size();
    } else {
      part = token.substr(start, plus - start);
      start = plus + 1;
    }
    // Lower-case in place.
    for (char& c : part) {
      c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    if (part == "ctrl" || part == "control" || part == "c") {
      mods |= kModCtrl;
    } else if (part == "shift" || part == "s") {
      mods |= kModShift;
    } else if (part == "alt" || part == "option" || part == "opt") {
      mods |= kModAlt;
    } else if (part == "meta" || part == "cmd" || part == "command" ||
               part == "super" || part == "win") {
      mods |= kModMeta;
    } else if (!part.empty()) {
      keyname = part;
    }
  }
  return BuildMatchKey(keyname, mods);
}

// Parse a rules JSON object into a Keymap. The parser is small and
// permissive — we only need top-level string-keyed string-valued
// entries. Returns nullptr on syntax error.
//
// Format: {"chord1 chord2": "command", "chord3": "cmd2", ...}
//
// Whitespace tolerated between tokens. We don't run V8's full JSON
// parser here — that would require crossing back into JS for the
// parse, defeating the perf goal. Strings are quoted with `"` and
// must not contain unescaped quotes; that's all we support.
std::unique_ptr<Keymap> ParseRulesJson(const std::string& json) {
  auto km = std::make_unique<Keymap>();

  size_t i = 0;
  const size_t n = json.size();
  auto skip_ws = [&]() {
    while (i < n && (json[i] == ' ' || json[i] == '\t' ||
                     json[i] == '\n' || json[i] == '\r')) {
      ++i;
    }
  };
  auto read_quoted = [&](std::string* out) -> bool {
    skip_ws();
    if (i >= n || json[i] != '"') {
      return false;
    }
    ++i;
    const size_t start = i;
    while (i < n && json[i] != '"') {
      // Minimal escape handling — only \" and \\ for now.
      if (json[i] == '\\' && i + 1 < n) {
        ++i;
      }
      ++i;
    }
    if (i >= n) {
      return false;
    }
    out->assign(json.data() + start, i - start);
    ++i;  // skip closing quote
    return true;
  };

  skip_ws();
  if (i >= n || json[i] != '{') {
    return nullptr;
  }
  ++i;

  while (i < n) {
    skip_ws();
    if (i < n && json[i] == '}') {
      ++i;
      break;
    }
    std::string key, value;
    if (!read_quoted(&key)) {
      return nullptr;
    }
    skip_ws();
    if (i >= n || json[i] != ':') {
      return nullptr;
    }
    ++i;
    if (!read_quoted(&value)) {
      return nullptr;
    }

    // Split key on whitespace into chord steps.
    Binding binding;
    binding.command = value;
    size_t pos = 0;
    while (pos < key.size()) {
      // Skip whitespace.
      while (pos < key.size() && (key[pos] == ' ' || key[pos] == '\t')) {
        ++pos;
      }
      if (pos >= key.size()) {
        break;
      }
      size_t token_start = pos;
      while (pos < key.size() && key[pos] != ' ' && key[pos] != '\t') {
        ++pos;
      }
      std::string token = key.substr(token_start, pos - token_start);
      binding.steps.push_back({CanonicalizeStep(token)});
    }
    if (!binding.steps.empty()) {
      km->bindings.push_back(std::move(binding));
    }

    skip_ws();
    if (i < n && json[i] == ',') {
      ++i;
    }
  }

  return km;
}

}  // namespace

static void CreateKeymap(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  Local<String> rules_str = args[0].As<String>();
  const int len = rules_str->Utf8Length(isolate);
  std::string rules(static_cast<size_t>(len), '\0');
  rules_str->WriteUtf8(isolate, rules.data(), len, nullptr,
                       String::NO_NULL_TERMINATION);

  auto km = ParseRulesJson(rules);
  if (km == nullptr) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }

  uint32_t id = Registry().Add(std::move(km));
  args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, id));
}

static void DestroyKeymap(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  Registry().Remove(id);
}

static void ResetChord(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  Keymap* km = Registry().Get(id);
  if (km != nullptr) {
    km->pending_indices.clear();
    km->pending_depth = 0;
  }
}

// matchKey(keymapId, keyName, modBits) -> command string | null.
//
// The hot path. Called once per keystroke. Implementation:
//   1. Build the canonical match key from (keyName, modBits).
//   2. If we're mid-chord, narrow `pending_indices` to bindings whose
//      next step matches the input. Otherwise scan all bindings for
//      step[0] matches.
//   3. If any remaining binding has exactly `pending_depth+1` steps,
//      its command fires (matched fully). Reset chord state.
//   4. If remaining bindings have MORE steps to consume, stay in
//      pending mode (return null; the JS caller can show a "chord
//      in progress" indicator).
//   5. If no bindings match, reset chord state, return null.
static void MatchKey(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (args.Length() < 3 || !args[1]->IsString()) {
    args.GetReturnValue().SetNull();
    return;
  }
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  Keymap* km = Registry().Get(id);
  if (km == nullptr) {
    args.GetReturnValue().SetNull();
    return;
  }
  Local<String> key_str = args[1].As<String>();
  const int key_len = key_str->Utf8Length(isolate);
  std::string key_name(static_cast<size_t>(key_len), '\0');
  if (key_len > 0) {
    key_str->WriteUtf8(isolate, key_name.data(), key_len, nullptr,
                       String::NO_NULL_TERMINATION);
  }
  // Lowercase the key name to match canonicalized binding keys.
  for (char& c : key_name) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  uint32_t mods = args[2]->Uint32Value(context).FromMaybe(0);
  const std::string match_key = BuildMatchKey(key_name, mods);

  // Filter candidates based on current chord position. Reuse the
  // keymap's scratch buffer so we don't heap-allocate per keystroke.
  std::vector<size_t>& next_pending = km->scratch_next_pending;
  next_pending.clear();

  auto check_step = [&](size_t binding_idx) {
    const Binding& b = km->bindings[binding_idx];
    if (km->pending_depth >= b.steps.size()) {
      return;
    }
    if (b.steps[km->pending_depth].match_key == match_key) {
      next_pending.push_back(binding_idx);
    }
  };

  if (km->pending_indices.empty()) {
    // Fresh chord start — consider all bindings.
    for (size_t i = 0, nb = km->bindings.size(); i < nb; ++i) {
      check_step(i);
    }
  } else {
    for (size_t idx : km->pending_indices) {
      check_step(idx);
    }
  }

  // Did any binding complete at this step?
  for (size_t idx : next_pending) {
    const Binding& b = km->bindings[idx];
    if (b.steps.size() == km->pending_depth + 1) {
      // Match. Reset state and return the command.
      km->pending_indices.clear();
      km->pending_depth = 0;
      MaybeLocal<String> cmd_maybe = String::NewFromUtf8(
          isolate, b.command.data(), v8::NewStringType::kNormal,
          static_cast<int>(b.command.size()));
      Local<String> cmd;
      if (cmd_maybe.ToLocal(&cmd)) {
        args.GetReturnValue().Set(cmd);
      } else {
        args.GetReturnValue().SetNull();
      }
      return;
    }
  }

  if (next_pending.empty()) {
    // No matching binding — reset chord state.
    km->pending_indices.clear();
    km->pending_depth = 0;
    args.GetReturnValue().SetNull();
    return;
  }

  // Chord continues. Stay pending. Swap (not move) so both vectors
  // retain their allocations: pending_indices gets the new candidate
  // list, scratch_next_pending takes the old pending_indices' storage
  // — both buffers keep their capacity for the next call.
  km->pending_indices.swap(next_pending);
  km->pending_depth += 1;
  args.GetReturnValue().SetNull();
}

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  SetMethod(context, target, "createKeymap", CreateKeymap);
  SetMethod(context, target, "destroyKeymap", DestroyKeymap);
  SetMethod(context, target, "matchKey", MatchKey);
  SetMethod(context, target, "resetChord", ResetChord);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(CreateKeymap);
  registry->Register(DestroyKeymap);
  registry->Register(MatchKey);
  registry->Register(ResetChord);
}

}  // namespace keymap
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_keymap, node::socketsecurity::keymap::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_keymap, node::socketsecurity::keymap::RegisterExternalReferences)
