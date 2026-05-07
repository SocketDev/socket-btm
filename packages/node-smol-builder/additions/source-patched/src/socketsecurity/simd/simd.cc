// simd.cc
// Global variables for SIMD runtime detection

#include "socketsecurity/simd/simd.h"

namespace smol {
namespace simd {

// Global AVX2 detection flag - set by Init() at module load
bool g_has_avx2 = false;

}  // namespace simd
}  // namespace smol
