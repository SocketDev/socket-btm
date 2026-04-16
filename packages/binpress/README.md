# binpress

Compresses a Node.js binary with zstd or UPX and wraps it in a small self-extracting stub (from stubs-builder). The result is a single executable that decompresses itself on launch via binflate.

Shrinks a ~25MB node-smol binary by roughly 30–50% depending on compression settings, with a one-time extraction cost at startup.
