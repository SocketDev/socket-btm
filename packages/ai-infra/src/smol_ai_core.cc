#include "smol_ai_core.h"

#include "llama.h"

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <map>
#include <memory>
#include <mutex>
#include <new>
#include <string>
#include <utility>
#include <vector>

namespace {

struct Model final {
  explicit Model(llama_model* value) : value(value) {}
  ~Model() { llama_model_free(value); }
  llama_model* value;
};

std::mutex g_models_mutex;
std::map<std::string, std::weak_ptr<Model>> g_models;
std::once_flag g_backend_once;

void IgnoreLog(ggml_log_level, const char*, void*) {}

void WriteError(char* output, size_t output_size, const std::string& message) {
  if (output == nullptr || output_size == 0) {
    return;
  }
  std::snprintf(output, output_size, "%s", message.c_str());
}

std::shared_ptr<Model> LoadModel(const std::string& path,
                                 std::string* error) {
  {
    const std::lock_guard<std::mutex> lock(g_models_mutex);
    const auto found = g_models.find(path);
    if (found != g_models.end()) {
      if (auto model = found->second.lock()) {
        return model;
      }
    }
  }

  std::call_once(g_backend_once, [] {
    llama_log_set(IgnoreLog, nullptr);
    llama_backend_init();
  });
  llama_model_params params = llama_model_default_params();
  params.n_gpu_layers = 0;
  llama_model* raw = llama_model_load_from_file(path.c_str(), params);
  if (raw == nullptr) {
    *error = "Unable to load the checksum-verified GGUF model";
    return nullptr;
  }
  auto loaded = std::make_shared<Model>(raw);
  {
    const std::lock_guard<std::mutex> lock(g_models_mutex);
    auto& existing = g_models[path];
    if (auto model = existing.lock()) {
      return model;
    }
    existing = loaded;
  }
  return loaded;
}

std::vector<llama_token> Tokenize(const llama_vocab* vocab,
                                  const char* input,
                                  size_t input_size,
                                  std::string* error) {
  const int32_t count =
      -llama_tokenize(vocab, input, input_size, nullptr, 0, true, true);
  if (count <= 0) {
    *error = "Unable to tokenize the prompt";
    return {};
  }
  std::vector<llama_token> tokens(static_cast<size_t>(count));
  const int32_t written = llama_tokenize(vocab, input, input_size,
                                         tokens.data(), count, true, true);
  if (written < 0) {
    *error = "Unable to tokenize the prompt";
    return {};
  }
  tokens.resize(static_cast<size_t>(written));
  return tokens;
}

bool ShouldAbort(void* data) {
  return static_cast<std::atomic<bool>*>(data)->load(
      std::memory_order_relaxed);
}

std::string TokenPiece(const llama_vocab* vocab,
                       llama_token token,
                       std::string* error) {
  char stack_buffer[256];
  int32_t size = llama_token_to_piece(vocab, token, stack_buffer,
                                      sizeof(stack_buffer), 0, true);
  if (size >= 0) {
    return std::string(stack_buffer, static_cast<size_t>(size));
  }
  std::vector<char> buffer(static_cast<size_t>(-size));
  size = llama_token_to_piece(vocab, token, buffer.data(), buffer.size(), 0,
                              true);
  if (size < 0) {
    *error = "Unable to decode a generated token";
    return {};
  }
  return std::string(buffer.data(), static_cast<size_t>(size));
}

}  // namespace

struct smol_ai_session {
  std::shared_ptr<Model> model;
  llama_context* context = nullptr;
  smol_ai_options options{};
  std::atomic<bool> cancelled{false};
  std::atomic<int32_t> input_usage{0};
  std::mutex mutex;
};

smol_ai_status smol_ai_session_create(const char* model_path,
                                      const smol_ai_options* options,
                                      smol_ai_session** output,
                                      char* error,
                                      size_t error_size) {
  if (model_path == nullptr || model_path[0] == '\0' || options == nullptr ||
      output == nullptr || options->max_tokens < 1 || options->threads < 1 ||
      options->top_k < 1 || options->temperature < 0.0F) {
    WriteError(error, error_size, "Invalid language model session options");
    return SMOL_AI_ERROR_ARGUMENT;
  }
  *output = nullptr;
  try {
    std::string detail;
    auto model = LoadModel(model_path, &detail);
    if (!model) {
      WriteError(error, error_size, detail);
      return SMOL_AI_ERROR_MODEL;
    }
    auto session = std::make_unique<smol_ai_session>();
    session->model = std::move(model);
    session->options = *options;

    llama_context_params params = llama_context_default_params();
    const int32_t trained = llama_model_n_ctx_train(session->model->value);
    params.n_ctx = static_cast<uint32_t>(
        std::clamp(trained, 256, 8192));
    params.n_batch = params.n_ctx;
    params.n_threads = options->threads;
    params.n_threads_batch = options->threads;
    params.no_perf = true;
    params.abort_callback = ShouldAbort;
    params.abort_callback_data = &session->cancelled;
    session->context = llama_init_from_model(session->model->value, params);
    if (session->context == nullptr) {
      WriteError(error, error_size,
                 "Unable to create a llama.cpp inference context");
      return SMOL_AI_ERROR_RUNTIME;
    }
    *output = session.release();
    return SMOL_AI_OK;
  } catch (const std::exception& exception) {
    WriteError(error, error_size, exception.what());
  } catch (...) {
    WriteError(error, error_size, "Unknown llama.cpp initialization failure");
  }
  return SMOL_AI_ERROR_RUNTIME;
}

void smol_ai_session_cancel(smol_ai_session* session) {
  if (session != nullptr) {
    session->cancelled.store(true, std::memory_order_relaxed);
  }
}

void smol_ai_session_reset_cancel(smol_ai_session* session) {
  if (session != nullptr) {
    session->cancelled.store(false, std::memory_order_relaxed);
  }
}

void smol_ai_session_destroy(smol_ai_session* session) {
  if (session == nullptr) {
    return;
  }
  llama_free(session->context);
  delete session;
}

int32_t smol_ai_session_input_quota(const smol_ai_session* session) {
  return session == nullptr ? 0
                            : static_cast<int32_t>(llama_n_ctx(session->context));
}

int32_t smol_ai_session_input_usage(const smol_ai_session* session) {
  return session == nullptr
             ? 0
             : session->input_usage.load(std::memory_order_relaxed);
}

smol_ai_status smol_ai_session_measure_input(smol_ai_session* session,
                                             const char* input,
                                             size_t input_size,
                                             int32_t* output,
                                             char* error,
                                             size_t error_size) {
  if (session == nullptr || input == nullptr || output == nullptr) {
    WriteError(error, error_size, "Invalid prompt input");
    return SMOL_AI_ERROR_ARGUMENT;
  }
  const std::lock_guard<std::mutex> lock(session->mutex);
  try {
    std::string detail;
    const auto tokens = Tokenize(llama_model_get_vocab(session->model->value),
                                 input, input_size, &detail);
    if (tokens.empty()) {
      WriteError(error, error_size, detail);
      return SMOL_AI_ERROR_RUNTIME;
    }
    *output = static_cast<int32_t>(tokens.size());
    return SMOL_AI_OK;
  } catch (const std::exception& exception) {
    WriteError(error, error_size, exception.what());
  } catch (...) {
    WriteError(error, error_size, "Unknown tokenizer failure");
  }
  return SMOL_AI_ERROR_RUNTIME;
}

smol_ai_status smol_ai_session_prompt(smol_ai_session* session,
                                      const char* input,
                                      size_t input_size,
                                      char** output,
                                      size_t* output_size,
                                      char* error,
                                      size_t error_size) {
  if (session == nullptr || input == nullptr || output == nullptr ||
      output_size == nullptr) {
    WriteError(error, error_size, "Invalid prompt input");
    return SMOL_AI_ERROR_ARGUMENT;
  }
  *output = nullptr;
  *output_size = 0;
  const std::lock_guard<std::mutex> lock(session->mutex);
  if (session->cancelled.load(std::memory_order_relaxed)) {
    WriteError(error, error_size, "Language model prompt was aborted");
    return SMOL_AI_ERROR_CANCELLED;
  }
  try {
    std::string detail;
    const llama_vocab* vocab = llama_model_get_vocab(session->model->value);
    auto tokens = Tokenize(vocab, input, input_size, &detail);
    if (tokens.empty()) {
      WriteError(error, error_size, detail);
      return SMOL_AI_ERROR_RUNTIME;
    }
    const int32_t quota = smol_ai_session_input_quota(session);
    if (static_cast<int32_t>(tokens.size()) + session->options.max_tokens >
        quota) {
      WriteError(error, error_size,
                 "Prompt and requested output exceed the model context");
      return SMOL_AI_ERROR_CONTEXT;
    }
    session->input_usage.store(static_cast<int32_t>(tokens.size()),
                               std::memory_order_relaxed);
    llama_memory_clear(llama_get_memory(session->context), true);

    llama_sampler_chain_params sampler_params =
        llama_sampler_chain_default_params();
    sampler_params.no_perf = true;
    llama_sampler* sampler = llama_sampler_chain_init(sampler_params);
    if (session->options.temperature == 0.0F ||
        session->options.top_k == 1) {
      llama_sampler_chain_add(sampler, llama_sampler_init_greedy());
    } else {
      llama_sampler_chain_add(
          sampler, llama_sampler_init_top_k(session->options.top_k));
      llama_sampler_chain_add(
          sampler, llama_sampler_init_temp(session->options.temperature));
      llama_sampler_chain_add(
          sampler,
          llama_sampler_init_dist(static_cast<uint32_t>(session->options.seed)));
    }

    std::string generated;
    llama_batch batch =
        llama_batch_get_one(tokens.data(), static_cast<int32_t>(tokens.size()));
    for (int32_t generated_tokens = 0;
         generated_tokens < session->options.max_tokens;
         ++generated_tokens) {
      if (session->cancelled.load(std::memory_order_relaxed)) {
        llama_sampler_free(sampler);
        WriteError(error, error_size, "Language model prompt was aborted");
        return SMOL_AI_ERROR_CANCELLED;
      }
      if (llama_decode(session->context, batch) != 0) {
        llama_sampler_free(sampler);
        if (session->cancelled.load(std::memory_order_relaxed)) {
          WriteError(error, error_size, "Language model prompt was aborted");
          return SMOL_AI_ERROR_CANCELLED;
        }
        WriteError(error, error_size, "llama.cpp failed to evaluate the prompt");
        return SMOL_AI_ERROR_RUNTIME;
      }
      const llama_token token =
          llama_sampler_sample(sampler, session->context, -1);
      if (llama_vocab_is_eog(vocab, token)) {
        break;
      }
      generated += TokenPiece(vocab, token, &detail);
      if (!detail.empty()) {
        llama_sampler_free(sampler);
        WriteError(error, error_size, detail);
        return SMOL_AI_ERROR_RUNTIME;
      }
      tokens[0] = token;
      batch = llama_batch_get_one(tokens.data(), 1);
    }
    llama_sampler_free(sampler);
    char* result = static_cast<char*>(std::malloc(generated.size() + 1));
    if (result == nullptr) {
      WriteError(error, error_size, "Unable to allocate prompt output");
      return SMOL_AI_ERROR_RUNTIME;
    }
    std::memcpy(result, generated.data(), generated.size());
    result[generated.size()] = '\0';
    *output = result;
    *output_size = generated.size();
    return SMOL_AI_OK;
  } catch (const std::exception& exception) {
    WriteError(error, error_size, exception.what());
  } catch (...) {
    WriteError(error, error_size, "Unknown llama.cpp inference failure");
  }
  return SMOL_AI_ERROR_RUNTIME;
}

void smol_ai_string_free(char* value) {
  std::free(value);
}
