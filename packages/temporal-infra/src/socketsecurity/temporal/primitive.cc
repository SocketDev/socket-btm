// 1:1 port of upstream `src/primitive.rs`. Header-only port lives in
// primitive.h (FiniteF64 + DoubleDouble). This .cc exists for the
// gyp source list to anchor any future non-inline implementations
// (e.g. a Display equivalent) and to provide a translation unit
// where ODR-able symbols can land.

#include "socketsecurity/temporal/primitive.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// All FiniteF64 and DoubleDouble methods are inline / templated in
// primitive.h. Reserved for future out-of-line definitions.

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
