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
