#ifndef DECOMPRESSOR_LIMITS_H
#define DECOMPRESSOR_LIMITS_H

/**
 * Maximum uncompressed binary size (in bytes) that the stub decompressor will extract.
 *
 * This limit prevents memory exhaustion attacks while allowing legitimate large binaries.
 * Modern Node.js binaries with debug symbols can exceed 100MB, so we use a generous limit.
 *
 * Current limit: 500MB
 * Rationale: Node.js binaries typically range from 60-150MB depending on platform and build options.
 *            500MB provides ample headroom for future growth while still preventing abuse.
 */
#define DECOMPRESSOR_MAX_UNCOMPRESSED_SIZE (500 * 1024 * 1024)

#endif /* DECOMPRESSOR_LIMITS_H */
