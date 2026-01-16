/* eslint-disable n/no-deprecated-api -- process.binding is required for VFS testing */
// Check VFS
const vfsBinding = process.binding('smol_vfs')
if (vfsBinding?.hasVFSBlob()) {
  console.log('VFS_AVAILABLE')

  // Initialize VFS using process.smol API
  const vfs = process.smol.vfs.initVFS()

  if (vfs) {
    console.log('VFS_INITIALIZED')
    console.log(`VFS_SIZE=${vfs.size}`)

    // Iterate VFS entries
    for (const [filepath, content] of vfs) {
      if (content === null) {
        console.log(`DIR: ${filepath}`)
      } else {
        console.log(`FILE: ${filepath} (${content.length} bytes)`)
        console.log(`CONTENT: ${content.toString()}`)
      }
    }
  }
} else {
  console.log('VFS_NOT_AVAILABLE')
}

console.log('SEA+VFS works!')
