/**
 * @fileoverview Embedded stub selection implementation
 */

#include "stub_selector.h"
#include "socketsecurity/bin-infra/binary_format.h"
#include "socketsecurity/build-infra/file_utils.h"
#include "socketsecurity/build-infra/file_io_common.h"
#include "socketsecurity/build-infra/tmpdir_common.h"
#include "socketsecurity/build-infra/debug_common.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#ifdef _WIN32
#include "socketsecurity/build-infra/posix_compat.h"
#else
#include <unistd.h>
#endif

// Forward declarations of embedded stubs (defined in embedded_stubs.c)
extern const unsigned char stub_darwin_arm64[];
extern const size_t stub_darwin_arm64_len;
extern const unsigned char stub_darwin_x64[];
extern const size_t stub_darwin_x64_len;

extern const unsigned char stub_linux_arm64[];
extern const size_t stub_linux_arm64_len;
extern const unsigned char stub_linux_x64[];
extern const size_t stub_linux_x64_len;
extern const unsigned char stub_linux_arm64_musl[];
extern const size_t stub_linux_arm64_musl_len;
extern const unsigned char stub_linux_x64_musl[];
extern const size_t stub_linux_x64_musl_len;

extern const unsigned char stub_win_arm64[];
extern const size_t stub_win_arm64_len;
extern const unsigned char stub_win_x64[];
extern const size_t stub_win_x64_len;

/**
 * Detect architecture from Mach-O binary
 */
static const char *detect_macho_architecture(const char *input_path) {
  FILE *f = fopen(input_path, "rb");
  if (!f) {
    fprintf(stderr, "Error: Cannot open %s for reading (errno: %d)\n", input_path, errno);
    return NULL;
  }

  uint32_t magic;
  if (fread(&magic, 1, sizeof(magic), f) != sizeof(magic)) {
    int saved_errno = errno;  // Preserve errno before fclose
    int eof = feof(f);
    fclose(f);
    if (eof) {
      fprintf(stderr, "Error: Unexpected EOF reading magic from %s\n", input_path);
    } else {
      errno = saved_errno;
      fprintf(stderr, "Error: Read error on %s (errno: %d)\n", input_path, saved_errno);
    }
    return NULL;
  }

  // Check for fat/universal binary
  if (magic == 0xcafebabe || magic == 0xbebafeca) {
    // Fat binary - read first architecture
    uint32_t nfat_arch;
    if (fread(&nfat_arch, 1, sizeof(nfat_arch), f) != sizeof(nfat_arch)) {
      int saved_errno = errno;  // Preserve errno before fclose
      fclose(f);
      errno = saved_errno;  // Restore errno for caller
      return NULL;
    }

    // Read first fat_arch structure
    uint32_t cputype;
    if (fread(&cputype, 1, sizeof(cputype), f) != sizeof(cputype)) {
      int saved_errno = errno;  // Preserve errno before fclose
      fclose(f);
      errno = saved_errno;  // Restore errno for caller
      return NULL;
    }

    fclose(f);

    // CPU_TYPE_ARM64 = 0x0100000c, CPU_TYPE_X86_64 = 0x01000007
    if (cputype == 0x0100000c || cputype == 0x0c000001) {
      return "arm64";
    }
    if (cputype == 0x01000007 || cputype == 0x07000001) {
      return "x64";
    }
    return NULL;
  }

  // Single architecture Mach-O
  // MH_MAGIC_64 = 0xfeedfacf (ARM64 or x64)
  // MH_CIGAM_64 = 0xcffaedfe (byte-swapped)
  if (magic == 0xfeedfacf || magic == 0xcffaedfe) {
    uint32_t cputype;
    if (fread(&cputype, 1, sizeof(cputype), f) != sizeof(cputype)) {
      int saved_errno = errno;  // Preserve errno before fclose
      fclose(f);
      errno = saved_errno;  // Restore errno for caller
      return NULL;
    }
    fclose(f);

    // CPU_TYPE_ARM64 = 0x0100000c
    // CPU_TYPE_X86_64 = 0x01000007
    if (cputype == 0x0100000c) {
      return "arm64";
    }
    if (cputype == 0x01000007) {
      return "x64";
    }
  }

  if (fclose(f) != 0) {
    fprintf(stderr, "Warning: Failed to close file (errno: %d - %s)\n",
            errno, strerror(errno));
  }
  return NULL;
}

/**
 * Detect architecture from ELF binary
 */
static const char *detect_elf_architecture(const char *input_path) {
  FILE *f = fopen(input_path, "rb");
  if (!f) {
    fprintf(stderr, "Error: Cannot open file: %s (errno: %d - %s)\n",
            input_path, errno, strerror(errno));
    return NULL;
  }

  // Read ELF header
  unsigned char elf_header[20];
  if (fread(elf_header, 1, 20, f) != 20) {
    fclose(f);
    return NULL;
  }
  fclose(f);

  // e_machine is at offset 18 (uint16_t)
  uint16_t e_machine = elf_header[18] | (elf_header[19] << 8);

  // EM_X86_64 = 62, EM_AARCH64 = 183
  if (e_machine == 62) {
    return "x64";
  }
  if (e_machine == 183) {
    return "arm64";
  }

  return NULL;
}

/**
 * Detect if ELF binary uses musl libc
 */
static int is_musl_elf(const char *input_path) {
  FILE *f = fopen(input_path, "rb");
  if (!f) {
    fprintf(stderr, "Error: Cannot open file: %s (errno: %d - %s)\n",
            input_path, errno, strerror(errno));
    return 0;
  }

  // Read ELF header
  unsigned char elf_header[64];
  if (fread(elf_header, 1, 64, f) != 64) {
    fclose(f);
    return 0;
  }

  // Check if 64-bit ELF
  int is_64bit = (elf_header[4] == 2);

  // Get program header offset and count
  size_t phoff, phentsize, phnum;
  if (is_64bit) {
    phoff = elf_header[32] | (elf_header[33] << 8) | (elf_header[34] << 16) |
            (elf_header[35] << 24) | ((size_t)elf_header[36] << 32) |
            ((size_t)elf_header[37] << 40) | ((size_t)elf_header[38] << 48) |
            ((size_t)elf_header[39] << 56);
    phentsize = elf_header[54] | (elf_header[55] << 8);
    phnum = elf_header[56] | (elf_header[57] << 8);
  } else {
    phoff = elf_header[28] | (elf_header[29] << 8) | (elf_header[30] << 16) |
            (elf_header[31] << 24);
    phentsize = elf_header[42] | (elf_header[43] << 8);
    phnum = elf_header[44] | (elf_header[45] << 8);
  }

  // Look for PT_INTERP program header (type = 3)
  for (size_t i = 0; i < phnum; i++) {
    // Check for integer overflow: phoff + i * phentsize
    // First check i * phentsize overflow
    if (phentsize != 0 && i > SIZE_MAX / phentsize) {
      break;  // Multiplication would overflow
    }
    size_t offset = i * phentsize;
    // Then check phoff + offset overflow
    if (phoff > SIZE_MAX - offset) {
      break;  // Addition would overflow
    }
    if (fseek(f, phoff + offset, SEEK_SET) != 0) {
      break;
    }

    unsigned char ph[56];
    if (fread(ph, 1, phentsize, f) != phentsize) {
      break;
    }

    uint32_t p_type = ph[0] | (ph[1] << 8) | (ph[2] << 16) | (ph[3] << 24);
    if (p_type == 3) { // PT_INTERP
      // Get offset to interpreter string
      size_t p_offset;
      if (is_64bit) {
        p_offset = ph[8] | (ph[9] << 8) | (ph[10] << 16) | (ph[11] << 24) |
                   ((size_t)ph[12] << 32) | ((size_t)ph[13] << 40) |
                   ((size_t)ph[14] << 48) | ((size_t)ph[15] << 56);
      } else {
        p_offset = ph[4] | (ph[5] << 8) | (ph[6] << 16) | (ph[7] << 24);
      }

      // Read interpreter path
      if (fseek(f, p_offset, SEEK_SET) == 0) {
        char interp[256];
        if (fgets(interp, sizeof(interp), f)) {
          fclose(f);
          // Check if interpreter path contains "musl"
          return (strstr(interp, "musl") != NULL);
        }
      }
      break;
    }
  }

  fclose(f);
  return 0;
}

/**
 * Detect architecture from PE binary
 */
static const char *detect_pe_architecture(const char *input_path) {
  FILE *f = fopen(input_path, "rb");
  if (!f) {
    fprintf(stderr, "Error: Cannot open file: %s (errno: %d - %s)\n",
            input_path, errno, strerror(errno));
    return NULL;
  }

  // Skip to PE offset (at 0x3C)
  if (fseek(f, 0x3C, SEEK_SET) != 0) {
    fclose(f);
    return NULL;
  }

  uint32_t pe_offset;
  if (fread(&pe_offset, 1, sizeof(pe_offset), f) != sizeof(pe_offset)) {
    fclose(f);
    return NULL;
  }

  // Seek to PE signature
  if (fseek(f, pe_offset, SEEK_SET) != 0) {
    fclose(f);
    return NULL;
  }

  // Skip PE signature (4 bytes) to get to COFF header
  if (fseek(f, 4, SEEK_CUR) != 0) {
    fclose(f);
    return NULL;
  }

  // Read Machine field (uint16_t at start of COFF header)
  uint16_t machine;
  if (fread(&machine, 1, sizeof(machine), f) != sizeof(machine)) {
    fclose(f);
    return NULL;
  }
  fclose(f);

  // IMAGE_FILE_MACHINE_AMD64 = 0x8664, IMAGE_FILE_MACHINE_ARM64 = 0xAA64
  if (machine == 0x8664) {
    return "x64";
  }
  if (machine == 0xAA64) {
    return "arm64";
  }

  return NULL;
}

const embedded_stub_t *select_stub_for_binary(const char *input_path) {
  // Read first 4 bytes to detect binary format
  FILE *f = fopen(input_path, "rb");
  if (!f) {
    fprintf(stderr, "Error: Cannot open binary: %s (%s)\n", input_path, strerror(errno));
    return NULL;
  }

  uint8_t magic[4];
  if (fread(magic, 1, 4, f) != 4) {
    int saved_errno = errno;  // Preserve errno before fclose
    int eof = feof(f);
    fclose(f);
    if (eof) {
      fprintf(stderr, "Error: Unexpected EOF reading magic bytes from binary\n");
    } else {
      errno = saved_errno;
      fprintf(stderr, "Error: Cannot read magic bytes from binary (errno: %d)\n", saved_errno);
    }
    return NULL;
  }
  fclose(f);

  // Detect binary format
  binary_format_t format = detect_binary_format(magic);

  switch (format) {
  case BINARY_FORMAT_MACHO: {
    // Detect macOS architecture
    const char *arch = detect_macho_architecture(input_path);
    if (!arch) {
      fprintf(stderr, "Error: Cannot detect macOS binary architecture\n");
      return NULL;
    }

    // Select stub based on architecture
    static embedded_stub_t stub_darwin;
    stub_darwin.platform = "darwin";
    stub_darwin.libc = NULL;

    if (strcmp(arch, "arm64") == 0) {
      stub_darwin.data = stub_darwin_arm64;
      stub_darwin.size = stub_darwin_arm64_len;
      stub_darwin.arch = "arm64";
      return &stub_darwin;
    }
    if (strcmp(arch, "x64") == 0 || strcmp(arch, "x86_64") == 0) {
      stub_darwin.data = stub_darwin_x64;
      stub_darwin.size = stub_darwin_x64_len;
      stub_darwin.arch = "x64";
      return &stub_darwin;
    }
    fprintf(stderr, "Error: Unsupported macOS architecture: %s\n", arch);
    return NULL;
  }

  case BINARY_FORMAT_ELF: {
    // Detect Linux architecture
    const char *arch = detect_elf_architecture(input_path);
    if (!arch) {
      fprintf(stderr, "Error: Cannot detect ELF binary architecture\n");
      return NULL;
    }

    // Detect musl vs glibc
    int use_musl = is_musl_elf(input_path);
    DEBUG_LOG("is_musl_elf() returned: %d for %s\n", use_musl, input_path);
    static embedded_stub_t stub_linux;
    stub_linux.platform = "linux";
    stub_linux.libc = use_musl ? "musl" : "glibc";

    if (strcmp(arch, "arm64") == 0) {
      if (use_musl) {
        stub_linux.data = stub_linux_arm64_musl;
        stub_linux.size = stub_linux_arm64_musl_len;
      } else {
        stub_linux.data = stub_linux_arm64;
        stub_linux.size = stub_linux_arm64_len;
      }
      stub_linux.arch = "arm64";
      return &stub_linux;
    }
    if (strcmp(arch, "x64") == 0) {
      if (use_musl) {
        stub_linux.data = stub_linux_x64_musl;
        stub_linux.size = stub_linux_x64_musl_len;
      } else {
        stub_linux.data = stub_linux_x64;
        stub_linux.size = stub_linux_x64_len;
      }
      stub_linux.arch = "x64";
      return &stub_linux;
    }
    fprintf(stderr, "Error: Unsupported Linux architecture: %s\n", arch);
    return NULL;
  }

  case BINARY_FORMAT_PE: {
    // Detect Windows architecture
    const char *arch = detect_pe_architecture(input_path);
    if (!arch) {
      fprintf(stderr, "Error: Cannot detect PE binary architecture\n");
      return NULL;
    }

    // Select stub based on architecture
    static embedded_stub_t stub_win;
    stub_win.platform = "win32";
    stub_win.libc = NULL;

    if (strcmp(arch, "arm64") == 0) {
      stub_win.data = stub_win_arm64;
      stub_win.size = stub_win_arm64_len;
      stub_win.arch = "arm64";
      return &stub_win;
    }
    if (strcmp(arch, "x64") == 0) {
      stub_win.data = stub_win_x64;
      stub_win.size = stub_win_x64_len;
      stub_win.arch = "x64";
      return &stub_win;
    }
    fprintf(stderr, "Error: Unsupported Windows architecture: %s\n", arch);
    return NULL;
  }

  default:
    fprintf(stderr, "Error: Unknown or unsupported binary format\n");
    return NULL;
  }
}

/**
 * Parse target string in format "platform-arch[-libc]"
 * Examples: "linux-x64-musl", "darwin-arm64", "win-x64"
 *
 * @param target Target string to parse
 * @param out_platform Output buffer for platform
 * @param platform_size Size of out_platform buffer
 * @param out_arch Output buffer for arch
 * @param arch_size Size of out_arch buffer
 * @param out_libc Output buffer for libc
 * @param libc_size Size of out_libc buffer
 * @return 0 on success, -1 on error
 */
static int parse_target_string(
    const char *target,
    char *out_platform, size_t platform_size,
    char *out_arch, size_t arch_size,
    char *out_libc, size_t libc_size
) {
  if (!target || !out_platform || !out_arch || !out_libc) {
    return -1;
  }

  // Manual parsing to avoid strtok_r issues on some platforms
  const char *p = target;
  const char *platform_start = p;

  // Find first hyphen (end of platform)
  while (*p && *p != '-') p++;
  if (*p == '\0' || p == platform_start) {
    fprintf(stderr, "Error: Invalid target format: %s (expected platform-arch[-libc])\n", target);
    fflush(stderr);
    return -1;
  }

  size_t platform_len = p - platform_start;
  if (platform_len >= platform_size) {
    fprintf(stderr, "Error: Platform name too long in target: %s\n", target);
    fflush(stderr);
    return -1;
  }

  memcpy(out_platform, platform_start, platform_len);
  out_platform[platform_len] = '\0';

  // Skip hyphen, find arch
  p++;
  const char *arch_start = p;
  while (*p && *p != '-') p++;
  if (p == arch_start) {
    fprintf(stderr, "Error: Missing architecture in target: %s\n", target);
    fflush(stderr);
    return -1;
  }

  size_t arch_len = (*p == '\0') ? strlen(arch_start) : (size_t)(p - arch_start);
  if (arch_len >= arch_size) {
    fprintf(stderr, "Error: Architecture name too long in target: %s\n", target);
    fflush(stderr);
    return -1;
  }

  memcpy(out_arch, arch_start, arch_len);
  out_arch[arch_len] = '\0';

  // Optional libc
  if (*p == '-') {
    p++;
    const char *libc_start = p;
    size_t libc_len = strlen(libc_start);
    if (libc_len == 0) {
      out_libc[0] = '\0';
    } else if (libc_len >= libc_size) {
      fprintf(stderr, "Error: Libc name too long in target: %s\n", target);
      fflush(stderr);
      return -1;
    } else {
      memcpy(out_libc, libc_start, libc_len);
      out_libc[libc_len] = '\0';
    }
  } else {
    out_libc[0] = '\0';
  }

  return 0;
}

const embedded_stub_t *select_stub_with_target(
    const char *input_path,
    const char *target,
    const char *target_platform,
    const char *target_arch,
    const char *target_libc
) {
  // Use separate static buffers for each call (thread-safe for single execution)
  static char parsed_platform_buf[16];
  static char parsed_arch_buf[16];
  static char parsed_libc_buf[16];

  DEBUG_LOG("select_stub_with_target: target=%s, target_platform=%s, target_arch=%s, target_libc=%s\n",
            target ? target : "NULL",
            target_platform ? target_platform : "NULL",
            target_arch ? target_arch : "NULL",
            target_libc ? target_libc : "NULL");

  // Priority 1: Parse combined target string if provided
  if (target) {
    // Clear buffers before parsing
    parsed_platform_buf[0] = '\0';
    parsed_arch_buf[0] = '\0';
    parsed_libc_buf[0] = '\0';

    DEBUG_LOG("Parsing combined target string: %s\n", target);
    if (parse_target_string(target,
                            parsed_platform_buf, sizeof(parsed_platform_buf),
                            parsed_arch_buf, sizeof(parsed_arch_buf),
                            parsed_libc_buf, sizeof(parsed_libc_buf)) != 0) {
      fprintf(stderr, "Error: Failed to parse target string: %s\n", target);
      fflush(stderr);
      return NULL;
    }
    DEBUG_LOG("Parsed: platform=%s, arch=%s, libc=%s\n",
              parsed_platform_buf, parsed_arch_buf, parsed_libc_buf[0] ? parsed_libc_buf : "NULL");
    target_platform = parsed_platform_buf;
    target_arch = parsed_arch_buf;
    target_libc = parsed_libc_buf[0] ? parsed_libc_buf : NULL;
  }

  // Priority 2: Use individual target parameters if no combined target
  // (Already set via function parameters)

  // Priority 3: Fall back to auto-detection if no target specified
  if (!target_platform && !target_arch && !target_libc) {
    return select_stub_for_binary(input_path);
  }

  // Normalize platform name (win -> win32 for internal use)
  const char *norm_platform = target_platform;
  if (target_platform && strcmp(target_platform, "win") == 0) {
    norm_platform = "win32";
  }

  // Detect missing parameters from input binary if needed
  const char *final_platform = norm_platform;
  const char *final_arch = target_arch;
  const char *final_libc = target_libc;

  if (!final_platform || !final_arch) {
    // Need to detect format/arch from binary
    FILE *f = fopen(input_path, "rb");
    if (!f) {
      fprintf(stderr, "Error: Cannot open binary: %s (%s)\n", input_path, strerror(errno));
      return NULL;
    }

    uint8_t magic[4];
    if (fread(magic, 1, 4, f) != 4) {
      int saved_errno = errno;  // Preserve errno before fclose
      int eof = feof(f);
      fclose(f);
      if (eof) {
        fprintf(stderr, "Error: Unexpected EOF reading magic bytes from binary\n");
      } else {
        errno = saved_errno;
        fprintf(stderr, "Error: Cannot read magic bytes from binary (errno: %d)\n", saved_errno);
      }
      return NULL;
    }
    fclose(f);

    binary_format_t format = detect_binary_format(magic);

    if (!final_platform) {
      switch (format) {
        case BINARY_FORMAT_MACHO: final_platform = "darwin"; break;
        case BINARY_FORMAT_ELF: final_platform = "linux"; break;
        case BINARY_FORMAT_PE: final_platform = "win32"; break;
        default:
          fprintf(stderr, "Error: Cannot detect platform from binary\n");
          return NULL;
      }
    }

    if (!final_arch) {
      switch (format) {
        case BINARY_FORMAT_MACHO: final_arch = detect_macho_architecture(input_path); break;
        case BINARY_FORMAT_ELF: final_arch = detect_elf_architecture(input_path); break;
        case BINARY_FORMAT_PE: final_arch = detect_pe_architecture(input_path); break;
        default: break;
      }
      if (!final_arch) {
        fprintf(stderr, "Error: Cannot detect architecture from binary\n");
        return NULL;
      }
    }

    // For Linux, detect libc if not specified
    if (strcmp(final_platform, "linux") == 0 && !final_libc) {
      int use_musl = is_musl_elf(input_path);
      final_libc = use_musl ? "musl" : "glibc";
      DEBUG_LOG("Auto-detected libc: %s\n", final_libc);
    }
  }

  DEBUG_LOG("Using target: %s-%s%s%s\n",
            final_platform, final_arch,
            final_libc ? "-" : "",
            final_libc ? final_libc : "");

  // Select stub based on final platform/arch/libc
  static embedded_stub_t stub;
  // Initialize all fields explicitly to avoid undefined behavior
  stub.data = NULL;
  stub.size = 0;
  stub.platform = final_platform;
  stub.arch = final_arch;
  stub.libc = final_libc;

  // Validate final_platform and final_arch are not NULL
  if (!final_platform || !final_arch) {
    fprintf(stderr, "Error: Missing platform or architecture specification\n");
    fflush(stderr);
    return NULL;
  }

  DEBUG_LOG("Final target: platform=%s, arch=%s, libc=%s\n",
            final_platform, final_arch, final_libc ? final_libc : "NULL");

  if (strcmp(final_platform, "darwin") == 0) {
    if (strcmp(final_arch, "arm64") == 0) {
      stub.data = stub_darwin_arm64;
      stub.size = stub_darwin_arm64_len;
      if (stub.size == 0) {
        fprintf(stderr, "Error: darwin-arm64 stub not available (size=0). Please ensure stubs are downloaded correctly.\n");
        fflush(stderr);
        return NULL;
      }
      return &stub;
    }
    if (strcmp(final_arch, "x64") == 0) {
      stub.data = stub_darwin_x64;
      stub.size = stub_darwin_x64_len;
      if (stub.size == 0) {
        fprintf(stderr, "Error: darwin-x64 stub not available (size=0). Please ensure stubs are downloaded correctly.\n");
        fflush(stderr);
        return NULL;
      }
      return &stub;
    }
    fprintf(stderr, "Error: Unsupported macOS architecture: %s\n", final_arch);
    return NULL;
  }

  if (strcmp(final_platform, "linux") == 0) {
    int use_musl = final_libc && strcmp(final_libc, "musl") == 0;

    if (strcmp(final_arch, "arm64") == 0) {
      stub.data = use_musl ? stub_linux_arm64_musl : stub_linux_arm64;
      stub.size = use_musl ? stub_linux_arm64_musl_len : stub_linux_arm64_len;
      stub.libc = use_musl ? "musl" : "glibc";
      if (stub.size == 0) {
        fprintf(stderr, "Error: linux-arm64%s stub not available (size=0). Please ensure stubs are downloaded correctly.\n",
                use_musl ? "-musl" : "");
        fflush(stderr);
        return NULL;
      }
      return &stub;
    }
    if (strcmp(final_arch, "x64") == 0) {
      stub.data = use_musl ? stub_linux_x64_musl : stub_linux_x64;
      stub.size = use_musl ? stub_linux_x64_musl_len : stub_linux_x64_len;
      stub.libc = use_musl ? "musl" : "glibc";
      if (stub.size == 0) {
        fprintf(stderr, "Error: linux-x64%s stub not available (size=0). Please ensure stubs are downloaded correctly.\n",
                use_musl ? "-musl" : "");
        fflush(stderr);
        return NULL;
      }
      return &stub;
    }
    fprintf(stderr, "Error: Unsupported Linux architecture: %s\n", final_arch);
    return NULL;
  }

  if (strcmp(final_platform, "win32") == 0) {
    if (strcmp(final_arch, "arm64") == 0) {
      stub.data = stub_win_arm64;
      stub.size = stub_win_arm64_len;
      if (stub.size == 0) {
        fprintf(stderr, "Error: win32-arm64 stub not available (size=0). Please ensure stubs are downloaded correctly.\n");
        fflush(stderr);
        return NULL;
      }
      return &stub;
    }
    if (strcmp(final_arch, "x64") == 0) {
      stub.data = stub_win_x64;
      stub.size = stub_win_x64_len;
      if (stub.size == 0) {
        fprintf(stderr, "Error: win32-x64 stub not available (size=0). Please ensure stubs are downloaded correctly.\n");
        fflush(stderr);
        return NULL;
      }
      return &stub;
    }
    fprintf(stderr, "Error: Unsupported Windows architecture: %s\n", final_arch);
    return NULL;
  }

  fprintf(stderr, "Error: Unsupported platform: %s\n", final_platform);
  return NULL;
}

int write_temp_stub(const embedded_stub_t *stub, char *output_path,
                    size_t path_size) {
  if (!stub || !output_path || path_size < 256) {
    fprintf(stderr, "Error: Invalid parameters to write_temp_stub\n");
    return -1;
  }

  // Create temp file with platform-specific temp directory
  const char *temp_dir = get_tmpdir(NULL);
#ifdef _WIN32
  snprintf(output_path, path_size, "%s\\binpress_stub_XXXXXX", temp_dir);
#else
  snprintf(output_path, path_size, "%s/binpress_stub_XXXXXX", temp_dir);
#endif

  int fd = mkstemp(output_path);
  if (fd == -1) {
    fprintf(stderr, "Error: Cannot create temp stub file: %s\n",
            strerror(errno));
    return -1;
  }

  // Prevent file descriptor/handle leaks to child processes (cross-platform).
  file_io_set_cloexec(fd);

  // Write stub data
  ssize_t total_written = 0;
  while (total_written < (ssize_t)stub->size) {
    ssize_t n =
        write(fd, stub->data + total_written, stub->size - total_written);
    if (n <= 0) {
      fprintf(stderr, "Error: Failed to write stub data: %s\n",
              strerror(errno));
      close(fd);
      unlink(output_path);
      return -1;
    }
    total_written += n;
  }

  // Sync data to disk before closing (prevents data loss on power failure).
  if (file_io_sync_fd(fd) != FILE_IO_OK) {
    fprintf(stderr, "Error: Failed to sync stub to disk: %s\n", output_path);
    close(fd);
    unlink(output_path);
    return -1;
  }

  close(fd);

  // Make executable (cross-platform).
  if (set_executable_permissions(output_path) != 0) {
    fprintf(stderr, "Error: Cannot make stub executable: %s\n",
            strerror(errno));
    unlink(output_path);
    return -1;
  }

  return 0;
}

void cleanup_temp_stub(const char *stub_path) {
  if (stub_path && stub_path[0] != '\0') {
    if (unlink(stub_path) != 0 && errno != ENOENT) {
      fprintf(stderr, "Warning: Failed to clean up temp stub %s: %s\n",
              stub_path, strerror(errno));
    }
  }
}
