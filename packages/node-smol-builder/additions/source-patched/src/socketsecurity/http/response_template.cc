#include "socketsecurity/http/response_template.h"
#include <cstring>

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
  // Pre-compute total size to avoid reallocations.
  size_t total_size = 0;
  size_t segment_index = 0;
  size_t placeholder_index = 0;

  while (segment_index < segments_.size() ||
         placeholder_index < placeholder_indices_.size()) {
    if (segment_index < segments_.size()) {
      total_size += segments_[segment_index].size();
      segment_index++;
    }
    if (placeholder_index < placeholder_indices_.size()) {
      size_t value_index = placeholder_indices_[placeholder_index];
      if (value_index < values.size()) {
        total_size += values[value_index].size();
      }
      placeholder_index++;
    }
  }

  // Single allocation with pre-computed size.
  std::string result;
  result.reserve(total_size);

  // Build result using memcpy into pre-allocated buffer.
  // resize() to total_size so we can memcpy directly.
  result.resize(total_size);
  char* dest = &result[0];
  size_t offset = 0;

  segment_index = 0;
  placeholder_index = 0;

  while (segment_index < segments_.size() ||
         placeholder_index < placeholder_indices_.size()) {
    if (segment_index < segments_.size()) {
      size_t len = segments_[segment_index].size();
      if (len > 0) {
        std::memcpy(dest + offset, segments_[segment_index].data(), len);
        offset += len;
      }
      segment_index++;
    }
    if (placeholder_index < placeholder_indices_.size()) {
      size_t value_index = placeholder_indices_[placeholder_index];
      if (value_index < values.size()) {
        size_t len = values[value_index].size();
        if (len > 0) {
          std::memcpy(dest + offset, values[value_index].data(), len);
          offset += len;
        }
      }
      placeholder_index++;
    }
  }

  return result;
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
