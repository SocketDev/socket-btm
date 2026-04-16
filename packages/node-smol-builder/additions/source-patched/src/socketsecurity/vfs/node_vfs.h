// ============================================================================
// node_vfs.h — Header file for the VFS native binding
// ============================================================================
//
// This is a HEADER FILE (.h). In C++, code is split into two kinds of files:
//   .h (header): Declares what exists — like a TypeScript .d.ts file.
//                It says "these functions exist" but doesn't show their code.
//   .cc (source): Defines the implementation — like the actual .js file
//                 that contains the function bodies.
//
// Other C++ files #include this header when they need to call VFS functions.
// The compiler uses it to know what functions are available and what types
// they accept/return, without needing to see the full implementation.
//
// WHAT THIS FILE DECLARES
//   - HasVFSBlob(): Check if embedded VFS data exists in the binary
//   - tar::CalculateChecksum(): Compute a TAR header checksum (SIMD-accelerated)
//   - tar::IsZeroBlock(): Detect end-of-archive markers (SIMD-accelerated)
//   - tar::ParseOctal(): Read octal numbers from TAR header fields
//
// KEY CONCEPTS
//   - VFS: Virtual File System — files embedded inside the compiled binary
//   - TAR: Tape Archive — a file format that bundles many files into one
//          (like a .zip but without compression). Each file has a 512-byte
//          header followed by its data, padded to 512-byte boundaries.
//   - SIMD: Single Instruction Multiple Data — CPU instructions that process
//           16 or 32 bytes at once instead of one byte at a time, making
//           operations like checksum calculation 50-100x faster.
//   - uint8_t, uint32_t, int64_t, size_t: Fixed-size integer types.
//           In JavaScript everything is just "number". In C++ you must
//           specify the exact size: uint8_t = 1 byte (0-255),
//           uint32_t = 4 bytes (0 to ~4 billion), int64_t = 8 bytes (signed),
//           size_t = pointer-sized unsigned (for array lengths).
// ============================================================================

#ifndef SRC_NODE_VFS_H_
#define SRC_NODE_VFS_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <cstdint>
#include <cstddef>

namespace node {
namespace smol_vfs {

// Check if SOCKETSECURITY_VFS_BLOB resource exists
bool HasVFSBlob();

// SIMD-accelerated TAR utilities
namespace tar {

// TAR header checksum calculation (512 bytes)
// Checksum field (bytes 148-155) is treated as 8 spaces
// Returns sum of all bytes in header
uint32_t CalculateChecksum(const uint8_t* header);

// Check if a 512-byte TAR block is all zeros (end of archive marker)
bool IsZeroBlock(const uint8_t* block);

// Parse octal string from TAR header field
// Returns parsed value, or 0 if empty/invalid
int64_t ParseOctal(const uint8_t* data, size_t len);

}  // namespace tar

}  // namespace smol_vfs
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS
#endif  // SRC_NODE_VFS_H_
