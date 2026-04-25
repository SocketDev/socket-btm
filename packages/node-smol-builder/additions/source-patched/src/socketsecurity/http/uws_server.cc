#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

#include "socketsecurity/http/uws_server.h"
#include "node_buffer.h"
#include "util-inl.h"

#include <cstring>
#include <new>

namespace node {
namespace smol_http {

using v8::Context;
using v8::External;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::HandleScope;
using v8::Int32;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::NewStringType;
using v8::Null;
using v8::Object;
using v8::ObjectTemplate;
using v8::String;
using v8::Uint32;
using v8::Value;

static const char* kParamKeys[] = {
  "0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15"
};
static const size_t kParamKeyLens[] = {
  1,1,1,1,1,1,1,1,1,1,2,2,2,2,2,2
};


// ============================================================================
// Lifecycle
// ============================================================================

UwsServer* UwsServer::Create(Environment* env) {
  // Split allocation into two phases so OOM on the uWS::App allocation does
  // not crash the process. The constructor does only trivial field setup;
  // Init() performs the throwing allocation with std::nothrow and returns
  // false on failure, at which point we destroy the partial instance.
  auto* server = new (std::nothrow) UwsServer(env);
  if (server == nullptr) {
    return nullptr;
  }
  if (!server->Init()) {
    delete server;
    return nullptr;
  }
  return server;
}

bool UwsServer::Init() {
  // uWS::App is the heavy allocation — a throwing `new` here would abort
  // because Node.js builds with -fno-exceptions. std::nothrow turns OOM into
  // a nullptr the caller can surface as a JS error.
  app_ = new (std::nothrow) uWS::App();
  return app_ != nullptr;
}

UwsServer::UwsServer(Environment* env) : env_(env) {
  Isolate* isolate = env->isolate();
  uWS::Loop::get(env->event_loop());

  str_method_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "method"));
  str_pathname_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "pathname"));
  str_query_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "query"));
  str_params_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "params"));
  str_get_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "GET"));
  str_post_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "POST"));
  str_put_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "PUT"));
  str_delete_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "DELETE"));
  str_empty_.Set(isolate, String::Empty(isolate));

  Local<ObjectTemplate> tmpl = ObjectTemplate::New(isolate);
  tmpl->SetInternalFieldCount(0);
  req_template_.Set(isolate, tmpl);
}

UwsServer::~UwsServer() {
  Stop();
  delete app_;
  app_ = nullptr;
}

void UwsServer::Stop() {
  if (listen_socket_) {
    us_listen_socket_close(0, listen_socket_);
    listen_socket_ = nullptr;
  }
}


// ============================================================================
// Static response caching — call handler once, cache result forever
// ============================================================================

void UwsServer::TryMakeStatic(uint32_t handler_id) {
  if (handler_needs_req_[handler_id]) return;

  Isolate* isolate = env_->isolate();
  HandleScope scope(isolate);
  Local<Context> context = env_->context();

  Local<Function> handler = handler_map_[handler_id].Get(isolate);

  Local<Value> result;
  if (!handler->Call(context, v8::Undefined(isolate), 0, nullptr)
        .ToLocal(&result)) {
    return;
  }

  StaticResponse& sr = static_responses_[handler_id];

  if (result->IsString()) {
    Local<String> str = result.As<String>();
    int body_len = str->Length();

    // Static caching is a fast-path optimization for small single-byte
    // ASCII responses — non-OneByte strings (any non-Latin-1 codepoint)
    // and responses over 16384 bytes fall back to the normal dynamic
    // path instead of being cached. A prior version would leave
    // `body_bytes` empty but still latch `is_static = true`, which
    // meant every subsequent request to a handler returning e.g.
    // "\u{1F600}hello" served an empty 200 — latched forever because
    // the handler is never re-invoked on is_static routes.
    if (body_len <= 0 || !str->IsOneByte() || body_len > 16384) {
      return;  // Leave is_static = false; dynamic path handles it.
    }

    // Pre-assemble the COMPLETE HTTP response: status + headers + body.
    // This gets written directly via us_socket_write — no cork, no writeStatus,
    // no writeHeader, no end(). The absolute fastest path possible.
    std::string body_bytes;
    body_bytes.resize(body_len);
    str->WriteOneByte(isolate, reinterpret_cast<uint8_t*>(&body_bytes[0]),
                      0, body_len);

    // Detect content type: JSON if starts with { or [, else text/plain.
    if (body_bytes[0] == '{' || body_bytes[0] == '[') {
      sr.content_type = "application/json";
    } else {
      sr.content_type = "text/plain";
    }

    sr.raw_response = body_bytes;
    sr.raw_length = body_bytes.size();
    sr.is_static = true;
  }
}


// ============================================================================
// Route registration
// ============================================================================

void UwsServer::AddRoute(const char* method, const char* pattern,
                          uint32_t handler_id) {
  UwsServer* server = this;
  auto handler = [server, handler_id](auto* res, auto* req) {
    HandleRequest(res, req, server, handler_id);
  };

  if (strcmp(method, "GET") == 0 || strcmp(method, "get") == 0)
    app_->get(pattern, std::move(handler));
  else if (strcmp(method, "POST") == 0 || strcmp(method, "post") == 0)
    app_->post(pattern, std::move(handler));
  else if (strcmp(method, "PUT") == 0 || strcmp(method, "put") == 0)
    app_->put(pattern, std::move(handler));
  else if (strcmp(method, "DELETE") == 0 || strcmp(method, "del") == 0)
    app_->del(pattern, std::move(handler));
  else if (strcmp(method, "PATCH") == 0 || strcmp(method, "patch") == 0)
    app_->patch(pattern, std::move(handler));
  else if (strcmp(method, "OPTIONS") == 0)
    app_->options(pattern, std::move(handler));
  else if (strcmp(method, "ANY") == 0 || strcmp(method, "any") == 0)
    app_->any(pattern, std::move(handler));
}

int UwsServer::Listen(const char* host, int port) {
  int actual_port = 0;
  app_->listen(host, port, [&actual_port, this](auto* socket) {
    if (socket) {
      listen_socket_ = socket;
      actual_port = us_socket_local_port(0, (struct us_socket_t*) socket);
    }
  });
  return actual_port;
}


// ============================================================================
// HandleRequest — THE HOT PATH
//
// Three tiers, fastest to slowest:
//   1. Static response (cached) — zero JS, zero V8, pure C++ cork+send
//   2. Zero-arg handler — skip request object, still call JS
//   3. Full handler — build request object, call JS
// ============================================================================

void UwsServer::HandleRequest(uWS::HttpResponse<false>* res,
                               uWS::HttpRequest* req,
                               UwsServer* server,
                               uint32_t handler_id) {
  if (handler_id >= server->handler_count_) {
    res->cork([res]() { res->writeStatus("404 Not Found")->end(""); });
    return;
  }

  // Tier 1: Static response — no JS, no V8, minimal uWS overhead.
  // With UWS_HTTPRESPONSE_NO_WRITEMARK, end() skips Date/uWS headers.
  // We pre-write Content-Type header and let end() handle the rest.
  const StaticResponse& sr = server->static_responses_[handler_id];
  if (sr.is_static) {
    res->cork([res, &sr]() {
      // Smuggle Content-Type into writeStatus to save 4 write calls.
      // Use the detected content type (text/plain or application/json).
      if (sr.content_type[0] == 'a') {  // "application/json"
        res->writeStatus("200 OK\r\nContent-Type: application/json");
      } else {
        res->writeStatus("200 OK\r\nContent-Type: text/plain");
      }
      res->end(std::string_view(sr.raw_response));
    });
    return;
  }

  // Tier 2 & 3: Need V8.
  HandleDynamicRequest(res, req, server, handler_id);
}


void UwsServer::HandleDynamicRequest(uWS::HttpResponse<false>* res,
                                      uWS::HttpRequest* req,
                                      UwsServer* server,
                                      uint32_t handler_id) {
  Environment* env = server->env();
  Isolate* isolate = env->isolate();
  HandleScope scope(isolate);
  Local<Context> context = env->context();

  Local<Function> handler = server->handler_map_[handler_id].Get(isolate);
  Local<Value> result;

  if (!server->handler_needs_req_[handler_id]) {
    // Tier 2: Zero-arg handler — skip request object.
    if (!handler->Call(context, v8::Undefined(isolate), 0, nullptr)
          .ToLocal(&result)) {
      res->cork([res]() {
        res->writeStatus("500 Internal Server Error")->end("");
      });
      return;
    }
  } else {
    // Tier 3: Build request object.
    // NewInstance returns an empty MaybeLocal under memory pressure or
    // if the template's constructor throws. ToLocalChecked on that
    // empty MaybeLocal aborts the whole isolate (→ remote DoS: every
    // concurrent request dies). Use ToLocal + a 500 response instead
    // so the offending request fails gracefully. Same shape as the
    // NewFromUtf8 guards below and the R19/R20/R23 fixes across this
    // file, but on a different V8 API the R26 gate didn't yet cover.
    Local<Object> js_req;
    if (!server->req_template_.Get(isolate)
              ->NewInstance(context)
              .ToLocal(&js_req)) {
      res->cork([res]() {
        res->writeStatus("500 Internal Server Error")->end("");
      });
      return;
    }

    // uWS does NOT UTF-8-validate HTTP request parts (method/url/
    // query/path-params) — only WebSocket text frames are validated.
    // A remote client can send raw bytes like `GET /\xff HTTP/1.1`
    // and ToLocalChecked would abort the isolate (→ remote DoS).
    // Reject the request with 400 on method/url/query decode failure
    // and skip individual malformed path-params rather than crash.
    // The kParamKeys[] entries are fixed ASCII literals — safe.

    // Method
    std::string_view method = req->getMethod();
    Local<String> method_str;
    switch (method.length()) {
      case 3:
        method_str = (method[0] == 'g') ? server->str_get_.Get(isolate)
                                        : server->str_put_.Get(isolate);
        break;
      case 4: method_str = server->str_post_.Get(isolate); break;
      case 6: method_str = server->str_delete_.Get(isolate); break;
      default:
        if (!String::NewFromUtf8(isolate, method.data(),
              NewStringType::kNormal, method.length()).ToLocal(&method_str)) {
          res->cork([res]() {
            res->writeStatus("400 Bad Request")->end("");
          });
          return;
        }
    }
    js_req->Set(context, server->str_method_.Get(isolate), method_str).Check();

    // Pathname
    std::string_view url = req->getUrl();
    Local<String> url_str;
    if (!String::NewFromUtf8(isolate, url.data(),
          url.length() <= 16 ? NewStringType::kInternalized : NewStringType::kNormal,
          url.length()).ToLocal(&url_str)) {
      res->cork([res]() {
        res->writeStatus("400 Bad Request")->end("");
      });
      return;
    }
    js_req->Set(context, server->str_pathname_.Get(isolate), url_str).Check();

    // Query
    std::string_view query = req->getQuery();
    if (query.length() > 0) {
      Local<String> query_str;
      if (!String::NewFromUtf8(isolate, query.data(), NewStringType::kNormal,
              query.length()).ToLocal(&query_str)) {
        res->cork([res]() {
          res->writeStatus("400 Bad Request")->end("");
        });
        return;
      }
      js_req->Set(context, server->str_query_.Get(isolate), query_str).Check();
    }

    // Params
    std::string_view first_param = req->getParameter(0);
    if (!first_param.empty()) {
      Local<Object> params = Object::New(isolate);
      Local<String> first_param_str;
      if (String::NewFromUtf8(isolate, first_param.data(), NewStringType::kNormal,
              first_param.length()).ToLocal(&first_param_str)) {
        params->Set(context,
          String::NewFromUtf8(isolate, kParamKeys[0], NewStringType::kInternalized,
                              kParamKeyLens[0]).ToLocalChecked(),
          first_param_str).Check();
      }
      for (unsigned int i = 1; i < 16; i++) {
        std::string_view param = req->getParameter(i);
        if (param.empty()) break;
        Local<String> param_str;
        if (!String::NewFromUtf8(isolate, param.data(), NewStringType::kNormal,
                param.length()).ToLocal(&param_str)) {
          // Skip this single malformed param — don't kill the request.
          continue;
        }
        params->Set(context,
          String::NewFromUtf8(isolate, kParamKeys[i], NewStringType::kInternalized,
                              kParamKeyLens[i]).ToLocalChecked(),
          param_str).Check();
      }
      js_req->Set(context, server->str_params_.Get(isolate), params).Check();
    }

    Local<Value> handler_args[] = { js_req };
    if (!handler->Call(context, v8::Undefined(isolate), 1, handler_args)
          .ToLocal(&result)) {
      res->cork([res]() {
        res->writeStatus("500 Internal Server Error")->end("");
      });
      return;
    }
  }

  WriteResponse(res, result, isolate);
}


// ============================================================================
// WriteResponse
// ============================================================================

void UwsServer::WriteResponse(uWS::HttpResponse<false>* res,
                               Local<Value> response,
                               Isolate* isolate) {
  res->cork([&]() {
    if (response->IsUndefined() || response->IsNull()) {
      res->writeStatus("404 Not Found")->end("");
      return;
    }

    if (response->IsString()) {
      Local<String> str = response.As<String>();
      int len = str->Length();

      if (len == 0) {
        res->writeStatus("200 OK\r\nContent-Type: text/plain")->end("");
        return;
      }

      if (str->IsOneByte()) {
        if (len <= 256) {
          uint8_t buf[256];
          str->WriteOneByte(isolate, buf, 0, len);
          res->writeStatus("200 OK\r\nContent-Type: text/plain")
             ->end(std::string_view(reinterpret_cast<char*>(buf), len));
        } else {
          // Under memory pressure the internal Utf8Value allocation
          // can fail; *text becomes nullptr. Passing nullptr into
          // uWS::end(std::string_view) reads from a null pointer when
          // uWS forwards the bytes to the socket. Surface a 500 and
          // return empty body instead of segfaulting the handler.
          String::Utf8Value text(isolate, response);
          if (*text == nullptr) {
            res->writeStatus("500 Internal Server Error")->end("");
            return;
          }
          res->writeStatus("200 OK\r\nContent-Type: text/plain")
             ->end(std::string_view(*text, text.length()));
        }
      } else {
        String::Utf8Value text(isolate, response);
        if (*text == nullptr) {
          res->writeStatus("500 Internal Server Error")->end("");
          return;
        }
        res->writeStatus("200 OK\r\nContent-Type: text/plain")
           ->end(std::string_view(*text, text.length()));
      }
      return;
    }

    if (response->IsObject()) {
      if (Buffer::HasInstance(response)) {
        const char* data = Buffer::Data(response);
        size_t blen = Buffer::Length(response);
        res->writeStatus("200 OK\r\nContent-Type: application/octet-stream")
           ->end(std::string_view(data, blen));
        return;
      }

      Local<Object> obj = response.As<Object>();
      Local<Context> context = isolate->GetCurrentContext();

      Local<Value> status_val;
      if (obj->Get(context, FIXED_ONE_BYTE_STRING(isolate, "status"))
              .ToLocal(&status_val) &&
          status_val->IsInt32()) {
        int status = status_val.As<Int32>()->Value();
        // Clamp to valid HTTP status range. Outside 100-999 the digit-
        // by-digit encoding below emits non-digit bytes into the status
        // line (e.g. status=1000 yields ":00"; status=-1 yields "00/"),
        // which some proxies interpret as response splitting or stream
        // desync. Fall back to 500 so a misbehaving handler produces a
        // well-formed error instead of garbage.
        if (status < 100 || status > 999) {
          status = 500;
        }
        char status_str[4];
        status_str[0] = '0' + (status / 100);
        status_str[1] = '0' + ((status / 10) % 10);
        status_str[2] = '0' + (status % 10);
        status_str[3] = '\0';
        res->writeStatus(status_str);

        Local<Value> body_text_val;
        if (obj->Get(context, FIXED_ONE_BYTE_STRING(isolate, "_bodyText"))
                .ToLocal(&body_text_val) &&
            body_text_val->IsString()) {
          Local<String> bstr = body_text_val.As<String>();
          int blen = bstr->Length();
          if (bstr->IsOneByte() && blen <= 256) {
            uint8_t buf[256];
            bstr->WriteOneByte(isolate, buf, 0, blen);
            res->end(std::string_view(reinterpret_cast<char*>(buf), blen));
          } else {
            // Utf8Value allocation can fail under pressure — null-check
            // *body before letting uWS dereference it. See upstream
            // guard in the plain-string branch above.
            String::Utf8Value body(isolate, body_text_val);
            if (*body == nullptr) {
              res->end("");
              return;
            }
            res->end(std::string_view(*body, body.length()));
          }
        } else {
          res->end("");
        }
        return;
      }

      // Plain object -> JSON
      Local<Value> json_str;
      if (v8::JSON::Stringify(context, obj).ToLocal(&json_str) &&
          json_str->IsString()) {
        Local<String> jstr = json_str.As<String>();
        int jlen = jstr->Length();
        if (jstr->IsOneByte() && jlen <= 256) {
          uint8_t buf[256];
          jstr->WriteOneByte(isolate, buf, 0, jlen);
          res->writeStatus("200 OK\r\nContent-Type: application/json")
             ->end(std::string_view(reinterpret_cast<char*>(buf), jlen));
        } else {
          // Strings > 256 chars can exceed any fixed stack buffer. Use
          // Utf8Value so large responses aren't silently truncated at the
          // buffer boundary, yielding malformed JSON on the wire. Match
          // the body-branch null-guard above for OOM robustness.
          String::Utf8Value body(isolate, jstr);
          if (*body == nullptr) {
            res->writeStatus("500 Internal Server Error")->end("");
            return;
          }
          res->writeStatus("200 OK\r\nContent-Type: application/json")
             ->end(std::string_view(*body, body.length()));
        }
        return;
      }
    }

    res->writeStatus("500 Internal Server Error")->end("");
  });
}


// ============================================================================
// V8 Bindings
// ============================================================================

void CreateUwsServer(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  // UwsServer::Create returns nullptr when the two-phase init OOMs on the
  // uWS::App allocation. Surface as a JS Error rather than wrapping nullptr
  // in an External — otherwise the next AddRoute/Listen/Stop call would
  // dereference it and SIGSEGV, defeating the whole point of the nothrow
  // rework.
  UwsServer* server = UwsServer::Create(env);
  if (server == nullptr) {
    Isolate* isolate = env->isolate();
    isolate->ThrowException(v8::Exception::Error(
        FIXED_ONE_BYTE_STRING(isolate,
            "Out of memory: failed to create UwsServer")));
    return;
  }
  args.GetReturnValue().Set(External::New(env->isolate(), server));
}

void UwsServerAddRoute(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  if (args.Length() < 5 || !args[0]->IsExternal()) return;

  UwsServer* server = static_cast<UwsServer*>(
    args[0].As<External>()->Value());

  String::Utf8Value method(isolate, args[1]);
  String::Utf8Value pattern(isolate, args[2]);
  // OOM during UTF-8 encoding leaves *utf8 as nullptr; passing nullptr
  // to the C-string AddRoute would crash in strcmp. Silently fail the
  // registration (matches the other "malformed input" early returns
  // in this entrypoint).
  if (*method == nullptr || *pattern == nullptr) return;
  if (!args[3]->IsUint32()) return;
  uint32_t handler_id = args[3].As<Uint32>()->Value();
  if (!args[4]->IsFunction()) return;

  // Reject handler_id >= 256 loudly. Previously this silently skipped
  // handler registration but still called AddRoute, attaching a route
  // whose handler slot was never initialized — every request to that
  // route then 404'd via the `handler_id >= handler_count_` guard in
  // HandleRequest. Production servers registering >256 routes saw the
  // overflow routes silently 404; local tests with fewer routes never
  // caught it.
  if (handler_id >= 256) {
    isolate->ThrowException(v8::Exception::RangeError(
        FIXED_ONE_BYTE_STRING(
            isolate, "Too many routes (max 256 per uWS server)")));
    return;
  }

  Local<Function> fn = args[4].As<Function>();
  server->handler_map_[handler_id].Reset(isolate, fn);

  // Check handler arity at registration.
  server->handler_needs_req_[handler_id] = true;
  Local<Value> length_val;
  if (fn->Get(env->context(), FIXED_ONE_BYTE_STRING(isolate, "length"))
          .ToLocal(&length_val) &&
      length_val->IsInt32() &&
      length_val.As<Int32>()->Value() == 0) {
    server->handler_needs_req_[handler_id] = false;
  }

  if (handler_id >= server->handler_count_)
    server->handler_count_ = handler_id + 1;

  // Try to cache as static response (zero-arg handlers returning constants).
  server->TryMakeStatic(handler_id);

  server->AddRoute(*method, *pattern, handler_id);
}

void UwsServerListen(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 3 || !args[0]->IsExternal()) return;

  UwsServer* server = static_cast<UwsServer*>(
    args[0].As<External>()->Value());

  String::Utf8Value host(isolate, args[1]);
  if (*host == nullptr) {
    // OOM encoding host — surface as failed listen (port=-1).
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  if (!args[2]->IsInt32()) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  int port = args[2].As<Int32>()->Value();

  int actual_port = server->Listen(*host, port);
  args.GetReturnValue().Set(Integer::New(isolate, actual_port));
}

void UwsServerStop(const FunctionCallbackInfo<Value>& args) {
  if (args.Length() < 1 || !args[0]->IsExternal()) return;
  UwsServer* server = static_cast<UwsServer*>(
    args[0].As<External>()->Value());
  server->Stop();
}

}  // namespace smol_http
}  // namespace node

#pragma GCC diagnostic pop
