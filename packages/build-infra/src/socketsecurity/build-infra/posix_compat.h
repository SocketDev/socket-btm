/**
 * posix_compat.h - Cross-platform POSIX compatibility for Windows
 *
 * Provides:
 * - POSIX types (mode_t, ssize_t) on MSVC
 * - POSIX function mappings (read, write, close, etc.) on Windows
 * - access() mode constants (F_OK, R_OK, W_OK, X_OK)
 *
 * IMPORTANT: This header does NOT define off_t. On Windows, off_t is defined
 * by <sys/types.h> as a 32-bit long. If you need 64-bit file offsets, use
 * _off64_t or __int64 explicitly. Attempting to redefine off_t causes
 * conflicts with system headers.
 *
 * MinGW already defines types via sys/types.h, so we only typedef on pure MSVC.
 * Function mappings are needed on both MSVC and MinGW.
 *
 * Usage: Include this header in any file that uses POSIX types or functions.
 */

#ifndef POSIX_COMPAT_H
#define POSIX_COMPAT_H

#ifdef _WIN32

#include <stdint.h>
#include <io.h>
#include <sys/types.h>  /* For off_t - do NOT redefine it */

/*
 * POSIX types - only needed on pure MSVC, MinGW provides these.
 * Guard each typedef individually since some may be defined by other headers.
 *
 * NOTE: off_t is NOT defined here - use the system's definition from sys/types.h
 * to avoid redefinition conflicts. Windows off_t is 32-bit (long).
 */
#if !defined(__MINGW32__) && !defined(__MINGW64__)
#ifndef _MODE_T_DEFINED
typedef unsigned int mode_t;
#define _MODE_T_DEFINED
#endif
/* Use both guard macros that different headers check */
#if !defined(_SSIZE_T_DEFINED) && !defined(_SSIZE_T_)
typedef intptr_t ssize_t;
#define _SSIZE_T_DEFINED
#define _SSIZE_T_
#endif
#endif

/*
 * POSIX function mappings - C code only.
 * Maps standard POSIX names to Windows CRT equivalents.
 *
 * IMPORTANT: These macros are DISABLED in C++ to avoid breaking
 * namespaced methods like LIEF::MachO::Builder::write().
 * C++ code should use _write(), _read(), etc. directly where needed,
 * or use the C++ standard library equivalents.
 */
#ifndef __cplusplus
#ifndef read
#define read _read
#endif
#ifndef write
#define write _write
#endif
#ifndef close
#define close _close
#endif
#ifndef lseek
#define lseek _lseek
#endif
#ifndef unlink
#define unlink _unlink
#endif
#ifndef access
#define access _access
#endif
#ifndef getpid
#define getpid _getpid
#endif
#endif /* __cplusplus */

/*
 * access() mode constants - standard values.
 */
#ifndef F_OK
#define F_OK 0  /* File exists */
#endif
#ifndef R_OK
#define R_OK 4  /* Read permission */
#endif
#ifndef W_OK
#define W_OK 2  /* Write permission */
#endif
#ifndef X_OK
#define X_OK 1  /* Execute permission (not reliable on Windows) */
#endif

/*
 * C++ safe function macros with POSIX_ prefix.
 * These don't conflict with namespaced methods like LIEF::Builder::write().
 * Use these in C++ code instead of raw POSIX function names.
 */
#define POSIX_READ _read
#define POSIX_WRITE _write
#define POSIX_CLOSE _close
#define POSIX_LSEEK _lseek
#define POSIX_UNLINK _unlink
#define POSIX_ACCESS _access
#define POSIX_GETPID _getpid

#else /* !_WIN32 */

/*
 * On POSIX systems, map POSIX_* macros to standard functions.
 * This allows C++ code to use POSIX_UNLINK() etc. portably.
 */
#define POSIX_READ read
#define POSIX_WRITE write
#define POSIX_CLOSE close
#define POSIX_LSEEK lseek
#define POSIX_UNLINK unlink
#define POSIX_ACCESS access
#define POSIX_GETPID getpid

#endif /* _WIN32 */

#endif /* POSIX_COMPAT_H */
