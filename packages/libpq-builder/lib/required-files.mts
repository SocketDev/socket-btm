/**
 * Required-files manifest for a libpq install.
 *
 * libpq's CMake island-build produces a single static library that
 * downstream consumers link against:
 *
 *   libpq.a  — PostgreSQL client static library
 *
 * Kept in its own file with zero imports so verify-release scripts
 * can read it standalone without workspace resolution.
 */
export const LIBPQ_REQUIRED_FILES = ['libpq.a']
