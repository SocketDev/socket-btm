/**
 * macho_compress_segment.h - Segment-based compression API
 */

#ifndef MACHO_COMPRESS_SEGMENT_H
#define MACHO_COMPRESS_SEGMENT_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Embed compressed data as SMOL segment in Mach-O binary.
 *
 * This creates a validly-signed self-extracting binary by inserting the
 * compressed data as a proper segment BEFORE __LINKEDIT, rather than
 * appending it after (which invalidates signatures).
 *
 * @param stub_path Path to stub binary (will be copied, not modified)
 * @param compressed_data_path Path to compressed data file
 * @param output_path Path for output binary
 * @param uncompressed_size Original uncompressed size (for metadata)
 * @return 0 on success, -1 on error
 */
int binpress_segment_embed(
    const char *stub_path,
    const char *compressed_data_path,
    const char *output_path,
    size_t uncompressed_size
);

/**
 * Extract compressed data from SMOL segment.
 * For testing/debugging only - actual extraction happens in stub.
 *
 * @param binary_path Path to binary with SMOL segment
 * @param output_path Path to write extracted compressed data
 * @return 0 on success, -1 on error
 */
int binpress_segment_extract(
    const char *binary_path,
    const char *output_path
);

#ifdef __cplusplus
}
#endif

#endif /* MACHO_COMPRESS_SEGMENT_H */
