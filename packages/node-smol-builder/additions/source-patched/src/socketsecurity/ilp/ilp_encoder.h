#ifndef SRC_SOCKETSECURITY_ILP_ILP_ENCODER_H_
#define SRC_SOCKETSECURITY_ILP_ILP_ENCODER_H_

#include <cstdint>
#include <string>
#include <vector>

namespace node {
namespace socketsecurity {
namespace ilp {

// Timestamp units for ILP protocol.
enum class TimestampUnit {
  kNanoseconds,
  kMicroseconds,
  kMilliseconds,
  kSeconds
};

// High-performance ILP line encoder.
// Builds ILP lines in a resizable buffer with minimal allocations.
class IlpEncoder {
 public:
  explicit IlpEncoder(size_t init_size = 65536, size_t max_size = 104857600);
  ~IlpEncoder() = default;

  // Non-copyable.
  IlpEncoder(const IlpEncoder&) = delete;
  IlpEncoder& operator=(const IlpEncoder&) = delete;

  // Move semantics.
  IlpEncoder(IlpEncoder&&) noexcept = default;
  IlpEncoder& operator=(IlpEncoder&&) noexcept = default;

  // Start a new row with table name.
  void Table(const char* name, size_t len);
  void Table(const std::string& name) { Table(name.c_str(), name.length()); }

  // Add symbol (tag) value - indexed for fast queries.
  void Symbol(const char* name, size_t name_len,
              const char* value, size_t value_len);
  void Symbol(const std::string& name, const std::string& value) {
    Symbol(name.c_str(), name.length(), value.c_str(), value.length());
  }

  // Column types.
  void StringColumn(const char* name, size_t name_len,
                    const char* value, size_t value_len);
  void StringColumn(const std::string& name, const std::string& value) {
    StringColumn(name.c_str(), name.length(), value.c_str(), value.length());
  }

  void BoolColumn(const char* name, size_t name_len, bool value);
  void BoolColumn(const std::string& name, bool value) {
    BoolColumn(name.c_str(), name.length(), value);
  }

  void IntColumn(const char* name, size_t name_len, int64_t value);
  void IntColumn(const std::string& name, int64_t value) {
    IntColumn(name.c_str(), name.length(), value);
  }

  void FloatColumn(const char* name, size_t name_len, double value);
  void FloatColumn(const std::string& name, double value) {
    FloatColumn(name.c_str(), name.length(), value);
  }

  void TimestampColumn(const char* name, size_t name_len,
                       int64_t value, TimestampUnit unit = TimestampUnit::kMicroseconds);
  void TimestampColumn(const std::string& name, int64_t value,
                       TimestampUnit unit = TimestampUnit::kMicroseconds) {
    TimestampColumn(name.c_str(), name.length(), value, unit);
  }

  // Finalize row with timestamp.
  void At(int64_t timestamp, TimestampUnit unit = TimestampUnit::kNanoseconds);
  void AtNow();

  // Buffer access.
  const char* Data() const { return buffer_.data(); }
  size_t Size() const { return position_; }
  size_t Capacity() const { return buffer_.size(); }
  bool Empty() const { return position_ == 0; }
  bool HasOverflowed() const { return overflow_; }

  // Reset buffer for reuse.
  void Clear() { position_ = 0; has_fields_ = false; overflow_ = false; }

  // Copy current buffer contents.
  std::vector<char> CopyBuffer() const {
    return std::vector<char>(buffer_.begin(), buffer_.begin() + position_);
  }

 private:
  void EnsureCapacity(size_t additional);
  void WriteChar(char c);
  void WriteBytes(const char* data, size_t len);
  void WriteEscapedName(const char* name, size_t len);
  void WriteEscapedString(const char* str, size_t len);
  void WriteEscapedSymbol(const char* str, size_t len);
  void WriteInt(int64_t value);
  void WriteDouble(double value);

  int64_t ConvertToNanos(int64_t value, TimestampUnit unit) const;

  std::vector<char> buffer_;
  size_t position_;
  size_t max_size_;
  bool has_fields_;
  bool overflow_;
};

}  // namespace ilp
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_ILP_ILP_ENCODER_H_
