#ifndef BIN_INFRA_STUB_EXE_PATH_H
#define BIN_INFRA_STUB_EXE_PATH_H

#include <stddef.h>
#include <stdio.h>

#if defined(__APPLE__)
#include <stdint.h>

#include <mach-o/dyld.h>
#elif defined(__linux__)
#include <errno.h>
#include <string.h>
#include <unistd.h>
#elif defined(_WIN32)
#include <windows.h>
#endif

/**
 * Write the path of the currently-running executable into `buf` (capacity
 * `size`). Returns 0 on success, -1 on failure. Shared by every stub (bin +
 * addon) — was duplicated per-platform in elf_stub.c / macho_stub.c / pe_stub.c.
 */
static inline int stub_executable_path(char *buf, size_t size) {
#if defined(__APPLE__)
    uint32_t bufsize = (uint32_t)size;
    if (_NSGetExecutablePath(buf, &bufsize) != 0) {
        fprintf(stderr, "Error: Buffer too small for executable path\n");
        return -1;
    }
    return 0;
#elif defined(__linux__)
    ssize_t len = readlink("/proc/self/exe", buf, size - 1);
    if (len == -1) {
        fprintf(stderr, "Error: Failed to get executable path: %s\n",
                strerror(errno));
        return -1;
    }
    buf[len] = '\0';
    return 0;
#elif defined(_WIN32)
    DWORD len = GetModuleFileNameA(NULL, buf, (DWORD)size);
    if (len == 0 || len >= size) {
        fprintf(stderr, "Error: Failed to get executable path\n");
        return -1;
    }
    return 0;
#else
    (void)buf;
    (void)size;
    fprintf(stderr, "Error: stub_executable_path unsupported on this platform\n");
    return -1;
#endif
}

#endif /* BIN_INFRA_STUB_EXE_PATH_H */
