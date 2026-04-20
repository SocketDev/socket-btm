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

    // Pre-assemble the COMPLETE HTTP response: status + headers + body.
    // This gets written directly via us_socket_write — no cork, no writeStatus,
    // no writeHeader, no end(). The absolute fastest path possible.
    std::string body_bytes;
    if (body_len > 0 && str->IsOneByte() && body_len <= 16384) {
      body_bytes.resize(body_len);
      str->WriteOneByte(isolate, reinterpret_cast<uint8_t*>(&body_bytes[0]),
                        0, body_len);
    }

    // Detect content type: JSON if starts with { or [, else text/plain.
    if (body_len > 0 && (body_bytes[0] == '{' || body_bytes[0] == '[')) {
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
    Local<Object> js_req = server->req_template_.Get(isolate)
      ->NewInstance(context).ToLocalChecked();

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
        method_str = String::NewFromUtf8(isolate, method.data(),
          NewStringType::kNormal, method.length()).ToLocalChecked();
    }
    js_req->Set(context, server->str_method_.Get(isolate), method_str).Check();

    // Pathname
    std::string_view url = req->getUrl();
    js_req->Set(context, server->str_pathname_.Get(isolate),
      String::NewFromUtf8(isolate, url.data(),
        url.length() <= 16 ? NewStringType::kInternalized : NewStringType::kNormal,
        url.length()).ToLocalChecked()).Check();

    // Query
    std::string_view query = req->getQuery();
    if (query.length() > 0) {
      js_req->Set(context, server->str_query_.Get(isolate),
        String::NewFromUtf8(isolate, query.data(), NewStringType::kNormal,
                            query.length()).ToLocalChecked()).Check();
    }

    // Params
    std::string_view first_param = req->getParameter(0);
    if (!first_param.empty()) {
      Local<Object> params = Object::New(isolate);
      params->Set(context,
        String::NewFromUtf8(isolate, kParamKeys[0], NewStringType::kInternalized,
                            kParamKeyLens[0]).ToLocalChecked(),
        String::NewFromUtf8(isolate, first_param.data(), NewStringType::kNormal,
                            first_param.length()).ToLocalChecked()).Check();
      for (unsigned int i = 1; i < 16; i++) {
        std::string_view param = req->getParameter(i);
        if (param.empty()) break;
        params->Set(context,
          String::NewFromUtf8(isolate, kParamKeys[i], NewStringType::kInternalized,
                              kParamKeyLens[i]).ToLocalChecked(),
          String::NewFromUtf8(isolate, param.data(), NewStringType::kNormal,
                              param.length()).ToLocalChecked()).Check();
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
          String::Utf8Value text(isolate, response);
          res->writeStatus("200 OK\r\nContent-Type: text/plain")
             ->end(std::string_view(*text, text.length()));
        }
      } else {
        String::Utf8Value text(isolate, response);
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
            String::Utf8Value body(isolate, body_text_val);
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
          char buf[4096];
          int utf8_len = jstr->WriteUtf8(isolate, buf, sizeof(buf), nullptr,
                                          String::NO_NULL_TERMINATION);
          res->writeStatus("200 OK\r\nContent-Type: application/json")
             ->end(std::string_view(buf, utf8_len));
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
  uint32_t handler_id = args[3].As<Uint32>()->Value();
  if (!args[4]->IsFunction()) return;

  if (handler_id < 256) {
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
  }

  server->AddRoute(*method, *pattern, handler_id);
}

void UwsServerListen(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 3 || !args[0]->IsExternal()) return;

  UwsServer* server = static_cast<UwsServer*>(
    args[0].As<External>()->Value());

  String::Utf8Value host(isolate, args[1]);
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
