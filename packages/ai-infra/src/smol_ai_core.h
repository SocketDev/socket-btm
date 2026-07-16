#ifndef SOCKETSECURITY_SMOL_AI_CORE_H_
#define SOCKETSECURITY_SMOL_AI_CORE_H_

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct smol_ai_session smol_ai_session;

typedef struct smol_ai_options {
  int32_t max_tokens;
  int32_t seed;
  float temperature;
  int32_t threads;
  int32_t top_k;
} smol_ai_options;

typedef enum smol_ai_status {
  SMOL_AI_OK = 0,
  SMOL_AI_ERROR_ARGUMENT = 1,
  SMOL_AI_ERROR_CANCELLED = 2,
  SMOL_AI_ERROR_CONTEXT = 3,
  SMOL_AI_ERROR_MODEL = 4,
  SMOL_AI_ERROR_RUNTIME = 5,
} smol_ai_status;

smol_ai_status smol_ai_session_create(const char* model_path,
                                      const smol_ai_options* options,
                                      smol_ai_session** output,
                                      char* error,
                                      size_t error_size);
void smol_ai_session_cancel(smol_ai_session* session);
void smol_ai_session_reset_cancel(smol_ai_session* session);
void smol_ai_session_destroy(smol_ai_session* session);
int32_t smol_ai_session_input_quota(const smol_ai_session* session);
int32_t smol_ai_session_input_usage(const smol_ai_session* session);
smol_ai_status smol_ai_session_measure_input(smol_ai_session* session,
                                             const char* input,
                                             size_t input_size,
                                             int32_t* output,
                                             char* error,
                                             size_t error_size);
smol_ai_status smol_ai_session_prompt(smol_ai_session* session,
                                      const char* input,
                                      size_t input_size,
                                      char** output,
                                      size_t* output_size,
                                      char* error,
                                      size_t error_size);
void smol_ai_string_free(char* value);

#ifdef __cplusplus
}
#endif

#endif
