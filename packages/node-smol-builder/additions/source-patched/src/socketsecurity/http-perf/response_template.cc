#include "socketsecurity/http-perf/response_template.h"
#include <cstring>
#include <sstream>

namespace node {
namespace socketsecurity {
namespace http_perf {

ResponseTemplate::ResponseTemplate() {}

ResponseTemplate::~ResponseTemplate() {}

ResponseTemplate* ResponseTemplate::Create(const char* format) {
  ResponseTemplate* tmpl = new ResponseTemplate();

  std::string current_segment;
  const char* p = format;

  while (*p) {
    if (*p == '{' && *(p + 1) >= '0' && *(p + 1) <= '9' && *(p + 2) == '}') {
      // Found placeholder: {N}
      tmpl->segments_.push_back(current_segment);
      current_segment.clear();

      // Extract placeholder index.
      size_t index = *(p + 1) - '0';
      tmpl->placeholder_indices_.push_back(index);

      p += 3; // Skip {N}
    } else {
      current_segment += *p;
      p++;
    }
  }

  // Add final segment.
  if (!current_segment.empty()) {
    tmpl->segments_.push_back(current_segment);
  }

  return tmpl;
}

std::string ResponseTemplate::Fill(
    const std::vector<std::string>& values) const {
  std::ostringstream result;

  size_t segment_index = 0;
  size_t placeholder_index = 0;

  // Interleave segments and placeholder values.
  while (segment_index < segments_.size() ||
         placeholder_index < placeholder_indices_.size()) {
    // Add segment.
    if (segment_index < segments_.size()) {
      result << segments_[segment_index];
      segment_index++;
    }

    // Add placeholder value.
    if (placeholder_index < placeholder_indices_.size()) {
      size_t value_index = placeholder_indices_[placeholder_index];
      if (value_index < values.size()) {
        result << values[value_index];
      }
      placeholder_index++;
    }
  }

  return result.str();
}

// Pre-compiled templates for common responses.
static ResponseTemplate* json_200_template = nullptr;
static ResponseTemplate* json_404_template = nullptr;
static ResponseTemplate* binary_200_template = nullptr;

const ResponseTemplate* ResponseTemplate::GetJsonTemplate(int status_code) {
  switch (status_code) {
    case 200:
      if (json_200_template == nullptr) {
        json_200_template = Create(
          "HTTP/1.1 200 OK\r\n"
          "Content-Type: application/json\r\n"
          "Content-Length: {0}\r\n"
          "\r\n");
      }
      return json_200_template;

    case 404:
      if (json_404_template == nullptr) {
        json_404_template = Create(
          "HTTP/1.1 404 Not Found\r\n"
          "Content-Type: application/json\r\n"
          "Content-Length: {0}\r\n"
          "\r\n");
      }
      return json_404_template;

    default:
      return nullptr;
  }
}

const ResponseTemplate* ResponseTemplate::GetBinaryTemplate(int status_code) {
  if (status_code == 200) {
    if (binary_200_template == nullptr) {
      binary_200_template = Create(
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: {0}\r\n"
        "Content-Length: {1}\r\n"
        "\r\n");
    }
    return binary_200_template;
  }

  return nullptr;
}

const ResponseTemplate* ResponseTemplate::GetErrorTemplate(int status_code) {
  // Reuse JSON templates for errors.
  return GetJsonTemplate(status_code);
}

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node
