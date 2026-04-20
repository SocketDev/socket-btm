// ============================================================================
// ilp_encoder.h -- Header for the ILP line-protocol text encoder
// ============================================================================
//
// WHAT THIS FILE DECLARES
//   IlpEncoder -- builds ILP-formatted text in a growable memory buffer.
//
//   ILP (Influx Line Protocol) is a simple text format for time-series data.
//   Each row has:
//     - a table name
//     - zero or more "symbols" (indexed string tags for fast filtering)
//     - one or more data columns (string, bool, int, float, timestamp)
//     - a row timestamp in nanoseconds
//
//   Example ILP line:
//     trades,ticker=AAPL price=175.5,volume=1000i 1625000000000000000\n
//
// WHY C++ INSTEAD OF JAVASCRIPT
//   Building thousands of ILP lines per second requires escaping special
//   characters and converting numbers to text very quickly.  The encoder
//   uses SIMD instructions (CPU-level parallelism that checks 16 bytes at
//   once) to skip escaping when strings are already safe -- something JS
//   cannot do.  It also writes directly into a pre-allocated byte buffer
//   instead of creating JS string objects, avoiding garbage-collection
//   overhead.
//
// HOW JAVASCRIPT USES THIS
//   IlpEncoder is not exposed to JS directly.  IlpBinding (ilp_binding.cc)
//   owns an encoder per "sender" and calls its methods (Table, Symbol,
//   StringColumn, ...) in response to JS calls.  When flush() is called,
//   the binding hands the encoder's buffer to IlpTransport for TCP send.
//
// KEY C++ CONCEPTS USED HERE
//   std::vector<char> buffer_
//     -- A dynamically-sized array (like a JS ArrayBuffer that can grow).
//        The encoder writes ILP text into this buffer.
//
//   size_t position_
//     -- How many bytes have been written so far (like an array index).
//
//   SIMD (Single Instruction, Multiple Data)
//     -- A CPU feature that processes 16 bytes in a single operation.
//        Used here to quickly scan strings for characters that need
//        escaping.  Falls back to one-byte-at-a-time on older CPUs.
// ============================================================================
#ifndef SRC_SOCKETSECURITY_ILP_ILP_ENCODER_H_
#define SRC_SOCKETSECURITY_ILP_ILP_ENCODER_H_

#include <cstdint>
#include <string>
#include <vector>

// Include shared SIMD utilities for fast string operations
#include "socketsecurity/simd/simd.h"

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
  mutable bool overflow_;
};

}  // namespace ilp
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_ILP_ILP_ENCODER_H_
