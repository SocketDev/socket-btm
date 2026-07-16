#include "env-inl.h"
#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "threadpoolwork-inl.h"
#include "util-inl.h"
#include "v8.h"

#include <array>
#include <atomic>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <new>
#include <string>
#include <utility>

#include "socketsecurity/language-model/smol_ai_core.h"

namespace node {
namespace socketsecurity {
namespace language_model {

using v8::Context;
using v8::Exception;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::Global;
using v8::HandleScope;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Undefined;
using v8::Value;

namespace {

constexpr size_t kErrorSize = 512;
using Session = std::shared_ptr<smol_ai_session>;

std::map<uint32_t, Session> sessions;
std::mutex sessions_mutex;
std::atomic<uint32_t> next_session_id{1};

Session FindSession(uint32_t id) {
  const std::lock_guard<std::mutex> lock(sessions_mutex);
  const auto found = sessions.find(id);
  return found == sessions.end() ? Session() : found->second;
}

const char* StatusCode(smol_ai_status status) {
  switch (status) {
    case SMOL_AI_ERROR_ARGUMENT:
      return "ERR_SMOL_AI_ARGUMENT";
    case SMOL_AI_ERROR_CANCELLED:
      return "ERR_SMOL_AI_ABORTED";
    case SMOL_AI_ERROR_CONTEXT:
      return "ERR_SMOL_AI_CONTEXT";
    case SMOL_AI_ERROR_MODEL:
      return "ERR_SMOL_AI_MODEL";
    case SMOL_AI_ERROR_RUNTIME:
      return "ERR_SMOL_AI_RUNTIME";
    case SMOL_AI_OK:
      return "ERR_SMOL_AI_UNKNOWN";
  }
  return "ERR_SMOL_AI_UNKNOWN";
}

Local<Value> ErrorValue(Isolate* isolate,
                        Local<Context> context,
                        const char* message,
                        const char* code) {
  Local<String> text;
  if (!String::NewFromUtf8(isolate, message).ToLocal(&text)) {
    text = FIXED_ONE_BYTE_STRING(isolate, "language model operation failed");
  }
  Local<Value> error = Exception::Error(text);
  error.As<Object>()
      ->Set(context,
            FIXED_ONE_BYTE_STRING(isolate, "code"),
            OneByteString(isolate, code))
      .Check();
  return error;
}

void CallResult(Environment* env,
                Global<Function>* callback,
                Local<Value> error,
                Local<Value> value) {
  Isolate* isolate = env->isolate();
  Local<Context> context = env->context();
  Local<Value> argv[] = {error, value};
  callback->Get(isolate)
      ->Call(context, Undefined(isolate), arraysize(argv), argv)
      .IsEmpty();
  callback->Reset();
}

bool ReadOptions(Isolate* isolate,
                 Local<Context> context,
                 Local<Value> value,
                 smol_ai_options* options) {
  if (!value->IsObject()) return false;
  Local<Object> object = value.As<Object>();
  Local<Value> max_tokens;
  Local<Value> seed;
  Local<Value> temperature;
  Local<Value> threads;
  Local<Value> top_k;
  if (!object
           ->Get(context, FIXED_ONE_BYTE_STRING(isolate, "maxTokens"))
           .ToLocal(&max_tokens) ||
      !object->Get(context, FIXED_ONE_BYTE_STRING(isolate, "seed"))
           .ToLocal(&seed) ||
      !object->Get(context, FIXED_ONE_BYTE_STRING(isolate, "temperature"))
           .ToLocal(&temperature) ||
      !object->Get(context, FIXED_ONE_BYTE_STRING(isolate, "threads"))
           .ToLocal(&threads) ||
      !object->Get(context, FIXED_ONE_BYTE_STRING(isolate, "topK"))
           .ToLocal(&top_k)) {
    return false;
  }
  options->max_tokens = max_tokens->Int32Value(context).FromMaybe(0);
  options->seed = seed->Int32Value(context).FromMaybe(-1);
  options->temperature =
      static_cast<float>(temperature->NumberValue(context).FromMaybe(-1));
  options->threads = threads->Int32Value(context).FromMaybe(0);
  options->top_k = top_k->Int32Value(context).FromMaybe(0);
  return true;
}

class CreateWork final : public ThreadPoolWork {
 public:
  CreateWork(Environment* env,
             std::string path,
             smol_ai_options options,
             Local<Function> callback)
      : ThreadPoolWork(env, "smol_ai.createSession"),
        path_(std::move(path)),
        options_(options) {
    callback_.Reset(env->isolate(), callback);
  }

  void DoThreadPoolWork() override {
    status_ = smol_ai_session_create(path_.c_str(), &options_, &session_,
                                     error_.data(), error_.size());
  }

  void AfterThreadPoolWork(int status) override {
    Environment* environment = env();
    Isolate* isolate = environment->isolate();
    HandleScope handle_scope(isolate);
    Local<Context> context = environment->context();
    Context::Scope context_scope(context);
    if (status != 0 || status_ != SMOL_AI_OK || session_ == nullptr) {
      if (session_ != nullptr) smol_ai_session_destroy(session_);
      CallResult(environment,
                 &callback_,
                 ErrorValue(isolate,
                            context,
                            error_[0] == '\0' ? "language model initialization failed"
                                              : error_.data(),
                            StatusCode(status_)),
                 Undefined(isolate));
      delete this;
      return;
    }
    const uint32_t id = next_session_id.fetch_add(1);
    Session shared(session_, smol_ai_session_destroy);
    {
      const std::lock_guard<std::mutex> lock(sessions_mutex);
      sessions.emplace(id, std::move(shared));
    }
    Local<Object> result = Object::New(isolate);
    result
        ->Set(context,
              FIXED_ONE_BYTE_STRING(isolate, "handle"),
              Integer::NewFromUnsigned(isolate, id))
        .Check();
    result
        ->Set(context,
              FIXED_ONE_BYTE_STRING(isolate, "inputQuota"),
              Integer::New(isolate, smol_ai_session_input_quota(session_)))
        .Check();
    CallResult(environment, &callback_, Undefined(isolate), result);
    delete this;
  }

 private:
  std::string path_;
  smol_ai_options options_{};
  smol_ai_session* session_ = nullptr;
  smol_ai_status status_ = SMOL_AI_ERROR_RUNTIME;
  std::array<char, kErrorSize> error_{};
  Global<Function> callback_;
};

class PromptWork final : public ThreadPoolWork {
 public:
  PromptWork(Environment* env,
             Session session,
             std::string input,
             Local<Function> callback)
      : ThreadPoolWork(env, "smol_ai.prompt"),
        session_(std::move(session)),
        input_(std::move(input)) {
    callback_.Reset(env->isolate(), callback);
  }

  ~PromptWork() override { smol_ai_string_free(output_); }

  void DoThreadPoolWork() override {
    status_ = smol_ai_session_prompt(session_.get(),
                                     input_.data(),
                                     input_.size(),
                                     &output_,
                                     &output_size_,
                                     error_.data(),
                                     error_.size());
  }

  void AfterThreadPoolWork(int status) override {
    Environment* environment = env();
    Isolate* isolate = environment->isolate();
    HandleScope handle_scope(isolate);
    Local<Context> context = environment->context();
    Context::Scope context_scope(context);
    if (status != 0 || status_ != SMOL_AI_OK) {
      CallResult(environment,
                 &callback_,
                 ErrorValue(isolate,
                            context,
                            error_[0] == '\0' ? "language model prompt failed"
                                              : error_.data(),
                            StatusCode(status_)),
                 Undefined(isolate));
      delete this;
      return;
    }
    Local<String> result;
    if (!String::NewFromUtf8(isolate,
                             output_,
                             v8::NewStringType::kNormal,
                             static_cast<int>(output_size_))
             .ToLocal(&result)) {
      CallResult(environment,
                 &callback_,
                 ErrorValue(isolate,
                            context,
                            "language model returned invalid UTF-8",
                            "ERR_SMOL_AI_RUNTIME"),
                 Undefined(isolate));
    } else {
      CallResult(environment, &callback_, Undefined(isolate), result);
    }
    delete this;
  }

 private:
  Session session_;
  std::string input_;
  char* output_ = nullptr;
  size_t output_size_ = 0;
  smol_ai_status status_ = SMOL_AI_ERROR_RUNTIME;
  std::array<char, kErrorSize> error_{};
  Global<Function> callback_;
};

void CreateSession(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = env->context();
  if (args.Length() != 3 || !args[0]->IsString() || !args[2]->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(FIXED_ONE_BYTE_STRING(
        isolate, "createSession requires model path, options, and callback")));
    return;
  }
  smol_ai_options options{};
  if (!ReadOptions(isolate, context, args[1], &options)) {
    isolate->ThrowException(Exception::TypeError(
        FIXED_ONE_BYTE_STRING(isolate, "invalid language model options")));
    return;
  }
  String::Utf8Value path(isolate, args[0]);
  if (*path == nullptr) {
    isolate->ThrowException(Exception::Error(
        FIXED_ONE_BYTE_STRING(isolate, "unable to encode model path")));
    return;
  }
  auto* work = new (std::nothrow)
      CreateWork(env, *path, options, args[2].As<Function>());
  if (work == nullptr) {
    isolate->ThrowException(Exception::Error(
        FIXED_ONE_BYTE_STRING(isolate, "unable to allocate model work")));
    return;
  }
  work->ScheduleWork();
}

void Prompt(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = env->context();
  if (args.Length() != 3 || !args[1]->IsString() || !args[2]->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(FIXED_ONE_BYTE_STRING(
        isolate, "prompt requires session, input, and callback")));
    return;
  }
  Session session = FindSession(args[0]->Uint32Value(context).FromMaybe(0));
  if (!session) {
    isolate->ThrowException(Exception::Error(
        FIXED_ONE_BYTE_STRING(isolate, "language model session is destroyed")));
    return;
  }
  String::Utf8Value input(isolate, args[1]);
  if (*input == nullptr) {
    isolate->ThrowException(Exception::Error(
        FIXED_ONE_BYTE_STRING(isolate, "unable to encode prompt")));
    return;
  }
  smol_ai_session_reset_cancel(session.get());
  auto* work = new (std::nothrow)
      PromptWork(env, std::move(session), *input, args[2].As<Function>());
  if (work == nullptr) {
    isolate->ThrowException(Exception::Error(
        FIXED_ONE_BYTE_STRING(isolate, "unable to allocate prompt work")));
    return;
  }
  work->ScheduleWork();
}

void Cancel(const FunctionCallbackInfo<Value>& args) {
  Local<Context> context = args.GetIsolate()->GetCurrentContext();
  Session session = FindSession(args[0]->Uint32Value(context).FromMaybe(0));
  if (session) smol_ai_session_cancel(session.get());
}

void Destroy(const FunctionCallbackInfo<Value>& args) {
  Local<Context> context = args.GetIsolate()->GetCurrentContext();
  const uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  Session session = FindSession(id);
  if (session) {
    smol_ai_session_cancel(session.get());
    const std::lock_guard<std::mutex> lock(sessions_mutex);
    sessions.erase(id);
  }
}

void InputUsage(const FunctionCallbackInfo<Value>& args) {
  Local<Context> context = args.GetIsolate()->GetCurrentContext();
  Session session = FindSession(args[0]->Uint32Value(context).FromMaybe(0));
  args.GetReturnValue().Set(
      Integer::New(args.GetIsolate(),
                   session ? smol_ai_session_input_usage(session.get()) : 0));
}

void MeasureInputUsage(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Session session = FindSession(args[0]->Uint32Value(context).FromMaybe(0));
  if (!session || !args[1]->IsString()) {
    isolate->ThrowException(Exception::TypeError(
        FIXED_ONE_BYTE_STRING(isolate, "valid session and input required")));
    return;
  }
  String::Utf8Value input(isolate, args[1]);
  if (*input == nullptr) return;
  int32_t measured = 0;
  std::array<char, kErrorSize> error{};
  const smol_ai_status status = smol_ai_session_measure_input(
      session.get(), *input, input.length(), &measured, error.data(), error.size());
  if (status != SMOL_AI_OK) {
    isolate->ThrowException(
        ErrorValue(isolate, context, error.data(), StatusCode(status)));
    return;
  }
  args.GetReturnValue().Set(Integer::New(isolate, measured));
}

void Initialize(Local<Object> target,
                Local<Value> unused,
                Local<Context> context,
                void* priv) {
  Isolate* isolate = Isolate::GetCurrent();
  SetMethod(context, target, "cancel", Cancel);
  SetMethod(context, target, "createSession", CreateSession);
  SetMethod(context, target, "destroy", Destroy);
  SetMethod(context, target, "inputUsage", InputUsage);
  SetMethod(context, target, "measureInputUsage", MeasureInputUsage);
  SetMethod(context, target, "prompt", Prompt);
  target
      ->Set(context,
            FIXED_ONE_BYTE_STRING(isolate, "runtimeId"),
            FIXED_ONE_BYTE_STRING(isolate, "llama.cpp-b9940"))
      .Check();
}

void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(Cancel);
  registry->Register(CreateSession);
  registry->Register(Destroy);
  registry->Register(InputUsage);
  registry->Register(MeasureInputUsage);
  registry->Register(Prompt);
}

}  // namespace
}  // namespace language_model
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_ai, node::socketsecurity::language_model::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_ai, node::socketsecurity::language_model::RegisterExternalReferences)
