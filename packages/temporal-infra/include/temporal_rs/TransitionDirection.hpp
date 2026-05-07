// Compat shim: temporal_rs::TransitionDirection. Used by V8's
// `ZonedDateTime::getTransition()` API to ask which DST transition
// to seek (next or previous). No temporal-infra equivalent yet —
// the dispatch path through TimeZoneBackend doesn't currently
// surface transition queries; if/when it does, FromInfra()/ToInfra()
// land here.

#ifndef TEMPORAL_RS_COMPAT_TRANSITIONDIRECTION_HPP_
#define TEMPORAL_RS_COMPAT_TRANSITIONDIRECTION_HPP_

namespace temporal_rs {

class TransitionDirection {
 public:
  enum Value {
    Next = 0,
    Previous = 1,
  };

  constexpr TransitionDirection() : value_(Next) {}
  constexpr TransitionDirection(Value v) : value_(v) {}
  constexpr operator Value() const { return value_; }
  explicit operator bool() const = delete;

 private:
  Value value_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_TRANSITIONDIRECTION_HPP_
