/**
 * @fileoverview Re-exports of compressed binary format constants.
 * Canonical definitions live in build-infra/lib/constants.mts so that
 * the C++ side (bin-infra/src/compression_constants.h) and both the
 * node-smol-builder scripts and build-infra helpers stay in lock-step.
 * The local `MAGIC_MARKER` alias preserves the naming callers have
 * always used; build-infra exports the same string as
 * SMOL_PRESSED_DATA_MAGIC_MARKER.
 */

export {
  ARCH_VALUES,
  COMPRESSION_VALUES,
  HEADER_SIZES,
  LIBC_VALUES,
  METADATA_HEADER_SIZE,
  PLATFORM_VALUES,
  SMOL_CONFIG_BINARY_SIZE,
  SMOL_CONFIG_MAGIC,
  SMOL_PRESSED_DATA_MAGIC_MARKER as MAGIC_MARKER,
  TOTAL_HEADER_SIZE_WITH_SMOL_CONFIG,
  TOTAL_HEADER_SIZE_WITHOUT_SMOL_CONFIG,
} from 'build-infra/lib/constants'
