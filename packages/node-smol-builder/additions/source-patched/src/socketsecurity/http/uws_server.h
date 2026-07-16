#ifndef SRC_SOCKETSECURITY_HTTP_UWS_SERVER_H_
#define SRC_SOCKETSECURITY_HTTP_UWS_SERVER_H_

#include "v8.h"
#include "node.h"
#include "env.h"
#include "env-inl.h"
#include "node_internals.h"

#include <App.h>
#include <string>

namespace node {
namespace smol_http {

// Pre-computed static response — cached at route registration time.
// For zero-arg handlers like () => '' or () => jsonString, we call the
// handler once, capture the response, and serve it from C++ without
// any JS calls on subsequent requests. This is the uWS StaticRoute pattern.
struct StaticResponse {
  bool is_static = false;
  std::string raw_response;        // cached body
  std::string content_type;        // "text/plain" or "application/json"
  size_t raw_length = 0;
};

class UwsServer {
 public:
  static UwsServer* Create(Environment* env);
  ~UwsServer();

  void AddRoute(const char* method, const char* pattern, uint32_t handler_id);
  int Listen(const char* host, int port);
  void Stop();

  Environment* env() const { return env_; }

  // Hot data first.
  Environment* env_;
  uWS::App* app_ = nullptr;
  uint32_t handler_count_ = 0;
  us_listen_socket_t* listen_socket_ = nullptr;

  // Request body size cap — mirrors the JS-side default in
  // internal/socketsecurity/http/constants.js (DEFAULT_MAX_BODY_SIZE).
  // Always set explicitly from CreateUwsServer (JS is the single source of
  // truth for the default); this field's initializer only covers the case
  // where a caller constructs a server without going through that binding.
  size_t max_body_size_ = 10 * 1024 * 1024;

  // Cached V8 strings.
  v8::Eternal<v8::String> str_method_;
  v8::Eternal<v8::String> str_pathname_;
  v8::Eternal<v8::String> str_query_;
  v8::Eternal<v8::String> str_params_;
  v8::Eternal<v8::String> str_get_;
  v8::Eternal<v8::String> str_post_;
  v8::Eternal<v8::String> str_put_;
  v8::Eternal<v8::String> str_delete_;
  v8::Eternal<v8::String> str_head_;
  v8::Eternal<v8::String> str_patch_;
  v8::Eternal<v8::String> str_options_;
  v8::Eternal<v8::String> str_method_query_;
  v8::Eternal<v8::String> str_body_;
  v8::Eternal<v8::String> str_empty_;

  v8::Eternal<v8::ObjectTemplate> req_template_;

  // Handler map.
  v8::Global<v8::Function> handler_map_[256];
  bool handler_needs_req_[256] = {};

  // Static response cache — for zero-arg handlers returning constant values.
  // Eliminates Function::Call entirely on the hot path.
  StaticResponse static_responses_[256];

  // Try to pre-compute a static response by calling the handler once.
  void TryMakeStatic(uint32_t handler_id);

 private:
  explicit UwsServer(Environment* env);

  // Second-phase init. The constructor only does trivial field setup so it
  // cannot fail; this method allocates the uWS::App with std::nothrow and
  // returns false on OOM. Create() invokes Init() and destroys the instance
  // if it returns false so callers never see a half-constructed server.
  bool Init();

  static void HandleRequest(uWS::HttpResponse<false>* res,
                            uWS::HttpRequest* req,
                            UwsServer* server,
                            uint32_t handler_id);

  static void HandleDynamicRequest(uWS::HttpResponse<false>* res,
                                   uWS::HttpRequest* req,
                                   UwsServer* server,
                                   uint32_t handler_id);

  // Body fully buffered (possibly empty — uWS always calls the data
  // handler at least once) — attach it to the request object and invoke
  // the JS handler. Shared by every Tier-3 method, not just QUERY/POST/PUT:
  // reading the body was previously unimplemented for ALL methods.
  static void FinishDynamicRequest(uWS::HttpResponse<false>* res,
                                   UwsServer* server,
                                   uint32_t handler_id,
                                   v8::Global<v8::Object>&& js_req_global,
                                   std::string&& body);

  static void WriteResponse(uWS::HttpResponse<false>* res,
                            v8::Local<v8::Value> response,
                            v8::Isolate* isolate);
};

void CreateUwsServer(const v8::FunctionCallbackInfo<v8::Value>& args);
void UwsServerAddRoute(const v8::FunctionCallbackInfo<v8::Value>& args);
void UwsServerListen(const v8::FunctionCallbackInfo<v8::Value>& args);
void UwsServerStop(const v8::FunctionCallbackInfo<v8::Value>& args);

}  // namespace smol_http
}  // namespace node

#endif  // SRC_SOCKETSECURITY_HTTP_UWS_SERVER_H_
