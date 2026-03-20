#include "socketsecurity/ilp/ilp_encoder.h"
#include <chrono>
#include <cstdio>
#include <cstring>

namespace node {
namespace socketsecurity {
namespace ilp {

IlpEncoder::IlpEncoder(size_t init_size, size_t max_size)
    : buffer_(init_size),
      position_(0),
      max_size_(max_size),
      has_fields_(false),
      overflow_(false) {}

void IlpEncoder::EnsureCapacity(size_t additional) {
  size_t needed = position_ + additional;
  if (needed <= buffer_.size()) {
    return;
  }

  if (needed > max_size_) {
    // Set overflow flag instead of throwing (Node.js uses -fno-exceptions).
    overflow_ = true;
    return;
  }

  // Grow by doubling, capped at max.
  size_t new_size = buffer_.size() * 2;
  while (new_size < needed) {
    new_size *= 2;
  }
  if (new_size > max_size_) {
    new_size = max_size_;
  }

  buffer_.resize(new_size);
}

void IlpEncoder::WriteChar(char c) {
  EnsureCapacity(1);
  if (overflow_) return;
  buffer_[position_++] = c;
}

void IlpEncoder::WriteBytes(const char* data, size_t len) {
  if (len == 0) return;
  EnsureCapacity(len);
  if (overflow_) return;
  std::memcpy(buffer_.data() + position_, data, len);
  position_ += len;
}

void IlpEncoder::WriteEscapedName(const char* name, size_t len) {
  // Table/column names: escape space, comma, equals.
  for (size_t i = 0; i < len; ++i) {
    char c = name[i];
    if (c == ' ' || c == ',' || c == '=') {
      WriteChar('\\');
    }
    WriteChar(c);
  }
}

void IlpEncoder::WriteEscapedString(const char* str, size_t len) {
  // String values: escape backslash, double quote, newline.
  for (size_t i = 0; i < len; ++i) {
    char c = str[i];
    if (c == '\\' || c == '"') {
      WriteChar('\\');
      WriteChar(c);
    } else if (c == '\n') {
      WriteChar('\\');
      WriteChar('n');
    } else if (c == '\r') {
      WriteChar('\\');
      WriteChar('r');
    } else {
      WriteChar(c);
    }
  }
}

void IlpEncoder::WriteEscapedSymbol(const char* str, size_t len) {
  // Symbol values: escape space, comma, equals, newline.
  for (size_t i = 0; i < len; ++i) {
    char c = str[i];
    if (c == ' ' || c == ',' || c == '=' || c == '\n' || c == '\r') {
      WriteChar('\\');
      if (c == '\n') {
        WriteChar('n');
      } else if (c == '\r') {
        WriteChar('r');
      } else {
        WriteChar(c);
      }
    } else {
      WriteChar(c);
    }
  }
}

void IlpEncoder::WriteInt(int64_t value) {
  char buf[32];
  int len = std::snprintf(buf, sizeof(buf), "%lld", static_cast<long long>(value));
  WriteBytes(buf, len);
}

void IlpEncoder::WriteDouble(double value) {
  char buf[32];
  int len = std::snprintf(buf, sizeof(buf), "%.15g", value);
  WriteBytes(buf, len);
}

int64_t IlpEncoder::ConvertToNanos(int64_t value, TimestampUnit unit) const {
  switch (unit) {
    case TimestampUnit::kNanoseconds:
      return value;
    case TimestampUnit::kMicroseconds:
      return value * 1000LL;
    case TimestampUnit::kMilliseconds:
      return value * 1000000LL;
    case TimestampUnit::kSeconds:
      return value * 1000000000LL;
    default:
      return value;
  }
}

void IlpEncoder::Table(const char* name, size_t len) {
  WriteEscapedName(name, len);
  has_fields_ = false;
}

void IlpEncoder::Symbol(const char* name, size_t name_len,
                        const char* value, size_t value_len) {
  WriteChar(',');
  WriteEscapedName(name, name_len);
  WriteChar('=');
  WriteEscapedSymbol(value, value_len);
}

void IlpEncoder::StringColumn(const char* name, size_t name_len,
                              const char* value, size_t value_len) {
  WriteChar(has_fields_ ? ',' : ' ');
  has_fields_ = true;
  WriteEscapedName(name, name_len);
  WriteChar('=');
  WriteChar('"');
  WriteEscapedString(value, value_len);
  WriteChar('"');
}

void IlpEncoder::BoolColumn(const char* name, size_t name_len, bool value) {
  WriteChar(has_fields_ ? ',' : ' ');
  has_fields_ = true;
  WriteEscapedName(name, name_len);
  WriteChar('=');
  WriteChar(value ? 't' : 'f');
}

void IlpEncoder::IntColumn(const char* name, size_t name_len, int64_t value) {
  WriteChar(has_fields_ ? ',' : ' ');
  has_fields_ = true;
  WriteEscapedName(name, name_len);
  WriteChar('=');
  WriteInt(value);
  WriteChar('i');
}

void IlpEncoder::FloatColumn(const char* name, size_t name_len, double value) {
  WriteChar(has_fields_ ? ',' : ' ');
  has_fields_ = true;
  WriteEscapedName(name, name_len);
  WriteChar('=');
  WriteDouble(value);
}

void IlpEncoder::TimestampColumn(const char* name, size_t name_len,
                                 int64_t value, TimestampUnit unit) {
  WriteChar(has_fields_ ? ',' : ' ');
  has_fields_ = true;
  WriteEscapedName(name, name_len);
  WriteChar('=');
  WriteInt(ConvertToNanos(value, unit));
  WriteChar('t');
}

void IlpEncoder::At(int64_t timestamp, TimestampUnit unit) {
  WriteChar(' ');
  WriteInt(ConvertToNanos(timestamp, unit));
  WriteChar('\n');
  has_fields_ = false;
}

void IlpEncoder::AtNow() {
  WriteChar('\n');
  has_fields_ = false;
}

}  // namespace ilp
}  // namespace socketsecurity
}  // namespace node
