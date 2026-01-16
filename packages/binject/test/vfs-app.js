/* eslint-disable n/no-deprecated-api -- process.binding is required for VFS testing */
const fs = require('node:fs')

// Check VFS
const vfsBinding = process.binding('smol_vfs')
if (vfsBinding?.hasVFSBlob()) {
  console.log('VFS_AVAILABLE')

  // Initialize VFS using process.smol API
  const vfs = process.smol.vfs.initVFS()

  if (vfs) {
    console.log('VFS_INITIALIZED')
    console.log(`VFS_SIZE=${vfs.size}`)

    // Try to read a file from VFS
    try {
      const content = fs.readFileSync('/test.txt', 'utf8')
      console.log(`VFS_CONTENT=${content}`)
    } catch (e) {
      console.log(`VFS_READ_ERROR=${e.message}`)
    }
  }
} else {
  console.log('VFS_NOT_AVAILABLE')
}

console.log('SEA works!')
