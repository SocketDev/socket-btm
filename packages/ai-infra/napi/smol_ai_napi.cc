#include "smol_ai_core.h"

#include <node_api.h>

#include <array>
#include <atomic>
#include <cstdio>
#include <cstdint>
#include <memory>
#include <mutex>
#include <new>
#include <string>

#ifndef NODE_GYP_MODULE_NAME
#define NODE_GYP_MODULE_NAME smol_ai
#endif

namespace {

constexpr size_t kErrorSize = 512;

struct SessionHolder {
  smol_ai_session* session = nullptr;
  std::atomic<bool> destroyed{false};
  std::mutex mutex;
};

void DestroySession(SessionHolder* holder) {
  if (holder == nullptr || holder->session == nullptr) {
    return;
  }
  smol_ai_session_cancel(holder->session);
  const std::lock_guard<std::mutex> lock(holder->mutex);
  if (holder->session != nullptr) {
    smol_ai_session_destroy(holder->session);
    holder->session = nullptr;
  }
}

void SetNamed(napi_env env,
              napi_value object,
              const char* name,
              napi_value value) {
  napi_set_named_property(env, object, name, value);
}

napi_value Undefined(napi_env env) {
  napi_value value;
  napi_get_undefined(env, &value);
  return value;
}

void Reject(napi_env env,
            napi_deferred deferred,
            const char* message,
            const char* code) {
  napi_value text;
  napi_value error;
  napi_value code_value;
  napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &text);
  napi_create_error(env, nullptr, text, &error);
  napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &code_value);
  SetNamed(env, error, "code", code_value);
  napi_reject_deferred(env, deferred, error);
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

bool ReadString(napi_env env, napi_value value, std::string* output) {
  size_t size = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok) {
    return false;
  }
  output->resize(size + 1);
  size_t written = 0;
  const bool success =
      napi_get_value_string_utf8(env, value, output->data(), size + 1,
                                 &written) == napi_ok;
  output->resize(written);
  return success;
}

bool ReadInt32(napi_env env,
               napi_value object,
               const char* name,
               int32_t* output) {
  napi_value value;
  return napi_get_named_property(env, object, name, &value) == napi_ok &&
         napi_get_value_int32(env, value, output) == napi_ok;
}

bool ReadDouble(napi_env env,
                napi_value object,
                const char* name,
                double* output) {
  napi_value value;
  return napi_get_named_property(env, object, name, &value) == napi_ok &&
         napi_get_value_double(env, value, output) == napi_ok;
}

SessionHolder* ReadHolder(napi_env env, napi_value value) {
  SessionHolder* holder = nullptr;
  if (napi_get_value_external(env, value,
                              reinterpret_cast<void**>(&holder)) != napi_ok ||
      holder == nullptr || holder->destroyed.load(std::memory_order_relaxed)) {
    napi_throw_error(env, "ERR_SMOL_AI_SESSION_DESTROYED",
                     "Language model session is destroyed");
    return nullptr;
  }
  return holder;
}

void FinalizeSession(napi_env, void* data, void*) {
  auto* holder = static_cast<SessionHolder*>(data);
  if (holder != nullptr) {
    holder->destroyed.store(true, std::memory_order_relaxed);
    DestroySession(holder);
    delete holder;
  }
}

struct CreateJob {
  napi_async_work work = nullptr;
  napi_deferred deferred;
  std::string model_path;
  smol_ai_options options{};
  smol_ai_session* session = nullptr;
  smol_ai_status status = SMOL_AI_ERROR_RUNTIME;
  std::array<char, kErrorSize> error{};
};

void ExecuteCreate(napi_env, void* data) {
  auto* job = static_cast<CreateJob*>(data);
  job->status = smol_ai_session_create(
      job->model_path.c_str(), &job->options, &job->session,
      job->error.data(), job->error.size());
}

void CompleteCreate(napi_env env, napi_status async_status, void* data) {
  std::unique_ptr<CreateJob> job(static_cast<CreateJob*>(data));
  if (async_status != napi_ok || job->status != SMOL_AI_OK) {
    if (job->session != nullptr) {
      smol_ai_session_destroy(job->session);
    }
    Reject(env, job->deferred,
           job->error[0] == '\0' ? "Language model initialization failed"
                                  : job->error.data(),
           StatusCode(job->status));
    napi_delete_async_work(env, job->work);
    return;
  }
  auto* holder = new (std::nothrow) SessionHolder();
  if (holder == nullptr) {
    smol_ai_session_destroy(job->session);
    Reject(env, job->deferred, "Unable to allocate a language model session",
           "ERR_SMOL_AI_RUNTIME");
    napi_delete_async_work(env, job->work);
    return;
  }
  holder->session = job->session;
  napi_value external;
  napi_create_external(env, holder, FinalizeSession, nullptr, &external);
  napi_value result;
  napi_create_object(env, &result);
  SetNamed(env, result, "handle", external);
  napi_value quota;
  napi_create_int32(env, smol_ai_session_input_quota(holder->session), &quota);
  SetNamed(env, result, "inputQuota", quota);
  napi_resolve_deferred(env, job->deferred, result);
  napi_delete_async_work(env, job->work);
}

napi_value CreateSession(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2) {
    napi_throw_type_error(env, "ERR_SMOL_AI_ARGUMENT",
                          "createSession requires a model path and options");
    return nullptr;
  }
  auto job = std::make_unique<CreateJob>();
  double temperature = 0;
  if (!ReadString(env, argv[0], &job->model_path) ||
      !ReadInt32(env, argv[1], "maxTokens", &job->options.max_tokens) ||
      !ReadInt32(env, argv[1], "seed", &job->options.seed) ||
      !ReadDouble(env, argv[1], "temperature", &temperature) ||
      !ReadInt32(env, argv[1], "threads", &job->options.threads) ||
      !ReadInt32(env, argv[1], "topK", &job->options.top_k)) {
    napi_throw_type_error(env, "ERR_SMOL_AI_ARGUMENT",
                          "Invalid native language model options");
    return nullptr;
  }
  job->options.temperature = static_cast<float>(temperature);
  napi_value promise;
  napi_create_promise(env, &job->deferred, &promise);
  napi_value name;
  napi_create_string_utf8(env, "smol_ai_create_session", NAPI_AUTO_LENGTH,
                          &name);
  napi_create_async_work(env, nullptr, name, ExecuteCreate, CompleteCreate,
                         job.get(), &job->work);
  napi_queue_async_work(env, job->work);
  job.release();
  return promise;
}

struct PromptJob {
  napi_async_work work = nullptr;
  napi_deferred deferred;
  napi_ref session_ref = nullptr;
  SessionHolder* holder = nullptr;
  std::string input;
  char* output = nullptr;
  size_t output_size = 0;
  smol_ai_status status = SMOL_AI_ERROR_RUNTIME;
  std::array<char, kErrorSize> error{};
};

void ExecutePrompt(napi_env, void* data) {
  auto* job = static_cast<PromptJob*>(data);
  const std::lock_guard<std::mutex> lock(job->holder->mutex);
  if (job->holder->destroyed.load(std::memory_order_relaxed) ||
      job->holder->session == nullptr) {
    job->status = SMOL_AI_ERROR_CANCELLED;
    std::snprintf(job->error.data(), job->error.size(), "%s",
                  "Language model session was destroyed");
    return;
  }
  job->status = smol_ai_session_prompt(
      job->holder->session, job->input.data(), job->input.size(), &job->output,
      &job->output_size, job->error.data(), job->error.size());
}

void CompletePrompt(napi_env env, napi_status async_status, void* data) {
  std::unique_ptr<PromptJob> job(static_cast<PromptJob*>(data));
  if (async_status != napi_ok || job->status != SMOL_AI_OK) {
    Reject(env, job->deferred,
           job->error[0] == '\0' ? "Language model prompt failed"
                                  : job->error.data(),
           StatusCode(job->status));
  } else {
    napi_value result;
    napi_create_string_utf8(env, job->output, job->output_size, &result);
    napi_resolve_deferred(env, job->deferred, result);
  }
  smol_ai_string_free(job->output);
  napi_delete_reference(env, job->session_ref);
  napi_delete_async_work(env, job->work);
}

napi_value Prompt(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2) {
    napi_throw_type_error(env, "ERR_SMOL_AI_ARGUMENT",
                          "prompt requires a session and input");
    return nullptr;
  }
  SessionHolder* holder = ReadHolder(env, argv[0]);
  if (holder == nullptr) {
    return nullptr;
  }
  auto job = std::make_unique<PromptJob>();
  job->holder = holder;
  if (!ReadString(env, argv[1], &job->input)) {
    napi_throw_type_error(env, "ERR_SMOL_AI_ARGUMENT",
                          "Prompt input must be a string");
    return nullptr;
  }
  smol_ai_session_reset_cancel(holder->session);
  napi_create_reference(env, argv[0], 1, &job->session_ref);
  napi_value promise;
  napi_create_promise(env, &job->deferred, &promise);
  napi_value name;
  napi_create_string_utf8(env, "smol_ai_prompt", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, nullptr, name, ExecutePrompt, CompletePrompt,
                         job.get(), &job->work);
  napi_queue_async_work(env, job->work);
  job.release();
  return promise;
}

napi_value Cancel(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc == 1) {
    SessionHolder* holder = ReadHolder(env, argv[0]);
    if (holder != nullptr) {
      smol_ai_session_cancel(holder->session);
    }
  }
  return Undefined(env);
}

napi_value Destroy(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc == 1) {
    SessionHolder* holder = nullptr;
    if (napi_get_value_external(env, argv[0],
                                reinterpret_cast<void**>(&holder)) == napi_ok &&
        holder != nullptr &&
        !holder->destroyed.exchange(true, std::memory_order_relaxed)) {
      DestroySession(holder);
    }
  }
  return Undefined(env);
}

napi_value InputUsage(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  SessionHolder* holder = argc == 1 ? ReadHolder(env, argv[0]) : nullptr;
  if (holder == nullptr) {
    return nullptr;
  }
  napi_value output;
  napi_create_int32(env, smol_ai_session_input_usage(holder->session), &output);
  return output;
}

napi_value MeasureInputUsage(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  SessionHolder* holder = argc == 2 ? ReadHolder(env, argv[0]) : nullptr;
  std::string input;
  if (holder == nullptr || !ReadString(env, argv[1], &input)) {
    if (holder != nullptr) {
      napi_throw_type_error(env, "ERR_SMOL_AI_ARGUMENT",
                            "Prompt input must be a string");
    }
    return nullptr;
  }
  int32_t measured = 0;
  std::array<char, kErrorSize> error{};
  smol_ai_status status;
  {
    const std::lock_guard<std::mutex> lock(holder->mutex);
    if (holder->destroyed.load(std::memory_order_relaxed) ||
        holder->session == nullptr) {
      napi_throw_error(env, "ERR_SMOL_AI_SESSION_DESTROYED",
                       "Language model session is destroyed");
      return nullptr;
    }
    status = smol_ai_session_measure_input(
        holder->session, input.data(), input.size(), &measured, error.data(),
        error.size());
  }
  if (status != SMOL_AI_OK) {
    napi_throw_error(env, StatusCode(status), error.data());
    return nullptr;
  }
  napi_value output;
  napi_create_int32(env, measured, &output);
  return output;
}

napi_value Init(napi_env env, napi_value exports) {
  const napi_property_descriptor properties[] = {
      {"cancel", nullptr, Cancel, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"createSession", nullptr, CreateSession, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"destroy", nullptr, Destroy, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"inputUsage", nullptr, InputUsage, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"measureInputUsage", nullptr, MeasureInputUsage, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"prompt", nullptr, Prompt, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };
  napi_define_properties(env, exports,
                         sizeof(properties) / sizeof(properties[0]), properties);
  napi_value runtime;
  napi_create_string_utf8(env, "llama.cpp-b9940", NAPI_AUTO_LENGTH, &runtime);
  SetNamed(env, exports, "runtimeId", runtime);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
