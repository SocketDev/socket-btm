// Split into sibling files:
// vfs-symlink-a.test.mts  — lstatSync/readlinkSync, EINVAL, async readlink callback
// vfs-symlink-b.test.mts  — promises.readlink, readdirSync withFileTypes, promises.lstat
