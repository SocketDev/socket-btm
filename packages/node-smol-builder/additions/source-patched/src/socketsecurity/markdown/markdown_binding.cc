// node:smol-tui Markdown parser binding.
//
// Wraps mity/md4c (CommonMark + GFM, C99). md4c is callback-driven: it
// emits enter/leave block, enter/leave span, and text events as it
// walks the document. We collect those events into a flat JS array of
// [type_code, payload] tuples; JS reconstructs the tree (cheaper than
// building a V8 object graph per node from C++).
//
// Surface: node:smol-tui.parseMarkdown(text, options?) -> Array<[code,
// payload]>.
//
// Event code layout (4-bit category + 12-bit value):
//
//   Category 0: block enter   (value = MD_BLOCKTYPE)
//   Category 1: block leave   (value = MD_BLOCKTYPE)
//   Category 2: span enter    (value = MD_SPANTYPE)
//   Category 3: span leave    (value = MD_SPANTYPE)
//   Category 4: text          (value = MD_TEXTTYPE)
//
// Payload is one of:
//   - undefined: no payload (block leave, span leave, text events
//     where text is empty)
//   - string: text content (text events) or attribute value
//   - object: structured detail (heading level, code language, list
//     style, table alignment, etc.) — only for block-enter events
//     that carry MD_BLOCK_*_DETAIL upstream.
//
// Flags option: comma-separated subset of md4c's MD_FLAG_* macros,
// e.g. "tables,strikethrough,permissive_autolinks". Default = ""
// (CommonMark strict). All MD_FLAG_* values from md4c.h are honored;
// unknown flag names are ignored.

#include "socketsecurity/markdown/md4c.h"

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "v8.h"

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace node {
namespace socketsecurity {
namespace markdown {

using v8::Array;
using v8::Context;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::Object;
using v8::String;
using v8::Value;

namespace {

// Event categories (high nibble of the type_code).
constexpr uint32_t kCatBlockEnter = 0u << 12;
constexpr uint32_t kCatBlockLeave = 1u << 12;
constexpr uint32_t kCatSpanEnter = 2u << 12;
constexpr uint32_t kCatSpanLeave = 3u << 12;
constexpr uint32_t kCatText = 4u << 12;

struct Event {
  uint32_t code;
  std::string text;  // empty for non-text events
  int heading_level;  // valid only for MD_BLOCK_H
  bool has_detail;
};

struct ParseState {
  std::vector<Event> events;
};

inline ParseState& StateOf(void* user) {
  return *static_cast<ParseState*>(user);
}

int OnEnterBlock(MD_BLOCKTYPE type, void* detail, void* user) {
  Event e{};
  e.code = kCatBlockEnter | static_cast<uint32_t>(type);
  if (type == MD_BLOCK_H && detail != nullptr) {
    const auto* d = static_cast<const MD_BLOCK_H_DETAIL*>(detail);
    e.heading_level = d->level;
    e.has_detail = true;
  } else {
    e.heading_level = 0;
    e.has_detail = false;
  }
  StateOf(user).events.push_back(std::move(e));
  return 0;
}

int OnLeaveBlock(MD_BLOCKTYPE type, void* /*detail*/, void* user) {
  Event e{};
  e.code = kCatBlockLeave | static_cast<uint32_t>(type);
  StateOf(user).events.push_back(std::move(e));
  return 0;
}

int OnEnterSpan(MD_SPANTYPE type, void* /*detail*/, void* user) {
  Event e{};
  e.code = kCatSpanEnter | static_cast<uint32_t>(type);
  StateOf(user).events.push_back(std::move(e));
  return 0;
}

int OnLeaveSpan(MD_SPANTYPE type, void* /*detail*/, void* user) {
  Event e{};
  e.code = kCatSpanLeave | static_cast<uint32_t>(type);
  StateOf(user).events.push_back(std::move(e));
  return 0;
}

int OnText(MD_TEXTTYPE type, const MD_CHAR* text, MD_SIZE size, void* user) {
  Event e{};
  e.code = kCatText | static_cast<uint32_t>(type);
  e.text.assign(text, size);
  StateOf(user).events.push_back(std::move(e));
  return 0;
}

// Parse a comma-separated flags string into the equivalent MD_FLAG_*
// bitfield. Names are case-insensitive; whitespace is ignored.
unsigned ParseFlags(const std::string& s) {
  struct FlagPair {
    const char* name;
    unsigned flag;
  };
  static const FlagPair kFlagMap[] = {
      {"collapse_whitespace", MD_FLAG_COLLAPSEWHITESPACE},
      {"permissive_atx_headers", MD_FLAG_PERMISSIVEATXHEADERS},
      {"permissive_url_autolinks", MD_FLAG_PERMISSIVEURLAUTOLINKS},
      {"permissive_email_autolinks", MD_FLAG_PERMISSIVEEMAILAUTOLINKS},
      {"no_indented_code_blocks", MD_FLAG_NOINDENTEDCODEBLOCKS},
      {"no_html_blocks", MD_FLAG_NOHTMLBLOCKS},
      {"no_html_spans", MD_FLAG_NOHTMLSPANS},
      {"tables", MD_FLAG_TABLES},
      {"strikethrough", MD_FLAG_STRIKETHROUGH},
      {"permissive_www_autolinks", MD_FLAG_PERMISSIVEWWWAUTOLINKS},
      {"tasklists", MD_FLAG_TASKLISTS},
      {"latex_math_spans", MD_FLAG_LATEXMATHSPANS},
      {"wikilinks", MD_FLAG_WIKILINKS},
      {"underline", MD_FLAG_UNDERLINE},
      {"hard_soft_breaks", MD_FLAG_HARD_SOFT_BREAKS},
      // Convenience aggregates:
      {"commonmark", 0u},
      {"github", MD_DIALECT_GITHUB},
  };
  unsigned out = 0;
  size_t i = 0;
  while (i < s.size()) {
    while (i < s.size() && (s[i] == ' ' || s[i] == ',' || s[i] == '\t')) {
      ++i;
    }
    size_t start = i;
    while (i < s.size() && s[i] != ',') {
      ++i;
    }
    size_t end = i;
    // Trim trailing whitespace.
    while (end > start &&
           (s[end - 1] == ' ' || s[end - 1] == '\t')) {
      --end;
    }
    if (end == start) {
      continue;
    }
    std::string token(s.data() + start, end - start);
    // Lower-case for case-insensitive match.
    for (size_t j = 0; j < token.size(); ++j) {
      const char c = token[j];
      if (c >= 'A' && c <= 'Z') {
        token[j] = static_cast<char>(c + ('a' - 'A'));
      }
    }
    for (const FlagPair& p : kFlagMap) {
      if (std::strcmp(p.name, token.c_str()) == 0) {
        out |= p.flag;
        break;
      }
    }
  }
  return out;
}

}  // namespace

static void ParseMarkdown(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().Set(Array::New(isolate, 0));
    return;
  }
  Local<String> input = args[0].As<String>();
  const int input_len = input->Utf8Length(isolate);

  std::string buf(static_cast<size_t>(input_len), '\0');
  if (input_len > 0) {
    input->WriteUtf8(isolate, buf.data(), input_len, nullptr,
                     String::NO_NULL_TERMINATION);
  }

  unsigned flags = 0;
  if (args.Length() >= 2 && args[1]->IsString()) {
    Local<String> flag_str = args[1].As<String>();
    int flag_len = flag_str->Utf8Length(isolate);
    if (flag_len > 0) {
      std::string flag_buf(static_cast<size_t>(flag_len), '\0');
      flag_str->WriteUtf8(isolate, flag_buf.data(), flag_len, nullptr,
                          String::NO_NULL_TERMINATION);
      flags = ParseFlags(flag_buf);
    }
  }

  ParseState state{};
  // Rough heuristic from sampling AI-output markdown: ~1 event per
  // 16 bytes of input (block-enter + text + block-leave per
  // paragraph + bullet + emphasis run). Pre-size to that estimate
  // so we usually avoid all reallocs during the parse. Small
  // documents stay near the minimum 64-entry floor.
  const size_t event_hint =
      buf.size() / 16 > 64 ? buf.size() / 16 : 64;
  state.events.reserve(event_hint);

  MD_PARSER parser{};
  parser.abi_version = 0;
  parser.flags = flags;
  parser.enter_block = OnEnterBlock;
  parser.leave_block = OnLeaveBlock;
  parser.enter_span = OnEnterSpan;
  parser.leave_span = OnLeaveSpan;
  parser.text = OnText;
  parser.debug_log = nullptr;
  parser.syntax = nullptr;

  md_parse(buf.data(), static_cast<MD_SIZE>(buf.size()), &parser, &state);

  // Convert events to JS array. Each event is a 2-element [code, payload]
  // tuple (sub-array). Payload is undefined / string / heading-level int.
  //
  // Hoist the undefined handle: most events (every block/span-leave plus
  // most enters) have no payload. v8::Undefined() returns the singleton
  // so it's free to call repeatedly, but the call still indirects through
  // the isolate; capturing it once and reusing the Local<Value> shaves a
  // ~5 ns isolate lookup per no-payload event.
  const size_t event_count = state.events.size();
  Local<Array> out =
      Array::New(isolate, static_cast<int>(event_count));
  Local<v8::Primitive> undef = v8::Undefined(isolate);
  for (size_t i = 0; i < event_count; ++i) {
    const Event& e = state.events[i];
    Local<Array> tuple = Array::New(isolate, 2);
    tuple->Set(context, 0, Integer::NewFromUnsigned(isolate, e.code))
        .Check();
    Local<Value> payload;
    if (!e.text.empty()) {
      MaybeLocal<String> s = String::NewFromUtf8(
          isolate, e.text.data(), v8::NewStringType::kNormal,
          static_cast<int>(e.text.size()));
      Local<String> s_local;
      if (s.ToLocal(&s_local)) {
        payload = s_local;
      } else {
        payload = undef;
      }
    } else if (e.has_detail) {
      payload = Integer::New(isolate, e.heading_level);
    } else {
      payload = undef;
    }
    tuple->Set(context, 1, payload).Check();
    out->Set(context, static_cast<uint32_t>(i), tuple).Check();
  }
  args.GetReturnValue().Set(out);
}

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  SetMethod(context, target, "parseMarkdown", ParseMarkdown);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(ParseMarkdown);
}

}  // namespace markdown
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_markdown, node::socketsecurity::markdown::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_markdown, node::socketsecurity::markdown::RegisterExternalReferences)
