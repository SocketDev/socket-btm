#ifndef SRC_NODE_VFS_H_
#define SRC_NODE_VFS_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

namespace node {
namespace smol_vfs {

// Check if SOCKETSECURITY_VFS_BLOB resource exists
bool HasVFSBlob();

}  // namespace smol_vfs
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS
#endif  // SRC_NODE_VFS_H_
