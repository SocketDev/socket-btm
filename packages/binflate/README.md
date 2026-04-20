# binflate

Self-extracting decompressor for binaries produced by binpress. Given a compressed artifact, binflate detects the compression format (zstd or UPX), decompresses into memory or a temp file, and hands execution off to the real binary.

Used at runtime by stub binaries — you rarely call it directly. See the stubs-builder package for how the stubs embed binflate.
