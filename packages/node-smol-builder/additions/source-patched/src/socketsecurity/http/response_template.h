#ifndef SRC_SOCKETSECURITY_HTTP_PERF_RESPONSE_TEMPLATE_H_
#define SRC_SOCKETSECURITY_HTTP_PERF_RESPONSE_TEMPLATE_H_

#include "v8.h"
#include <string>
#include <vector>

namespace node {
namespace socketsecurity {
namespace http_perf {

// Pre-compiled response template for fast response generation.
// Eliminates string concatenation overhead.
class ResponseTemplate {
 public:
  ResponseTemplate();
  ~ResponseTemplate();

  // Create template from format string with placeholders.
  // Placeholders: {0}, {1}, {2}, etc.
  static ResponseTemplate* Create(const char* format);

  // Fill template with values.
  std::string Fill(const std::vector<std::string>& values) const;

  // Get pre-compiled templates for common responses.
  static const ResponseTemplate* GetJsonTemplate(int status_code);
  static const ResponseTemplate* GetBinaryTemplate(int status_code);
  static const ResponseTemplate* GetErrorTemplate(int status_code);

 private:
  // Template segments (literal strings between placeholders).
  std::vector<std::string> segments_;

  // Placeholder positions (index in values array).
  std::vector<size_t> placeholder_indices_;
};

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_HTTP_PERF_RESPONSE_TEMPLATE_H_
