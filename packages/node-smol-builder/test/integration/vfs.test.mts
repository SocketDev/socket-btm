// Split into sibling files along describe-block seams to satisfy the 1000-line hard cap.
// Each sibling file carries its own beforeAll/afterAll for testTmpDir setup/teardown.
//
// vfs-sea-tar.test.mts              — SEA fuse, TAR archive creation, dual injection
// vfs-extraction-dlx.test.mts       — extraction to ~/.socket/_dlx/, path validation
// vfs-tar-format.test.mts           — TAR format support, mountSync, file permissions
// vfs-fs-shim-a.test.mts            — fs shim enhancements (async readFile, stat, EROFS, realpath, captured refs)
// vfs-fs-shim-b.test.mts            — fs shim enhancements (access, lstat, promises.stat/readdir, promises.access/realpath)
// vfs-fs-shim-c.test.mts            — fs shim enhancements (existsSync, readdirSync withFileTypes, EISDIR)
// vfs-symlink-a.test.mts            — symlink support (lstatSync/readlinkSync, EINVAL, async readlink)
// vfs-symlink-b.test.mts            — symlink support (promises.readlink, readdirSync withFileTypes, promises.lstat)
// vfs-glob-mode.test.mts            — glob support and mode flags
// vfs-traversal.test.mts            — path traversal protection
