/**
 * @fileoverview Embedded stub selection implementation
 */

#include "stub_selector.h"
#include "binary_format.h"
#include "file_utils.h"
#include "tmpdir_common.h"
#include "debug_common.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

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
    return NULL;
  }

  uint32_t magic;
  if (fread(&magic, 1, sizeof(magic), f) != sizeof(magic)) {
    fclose(f);
    return NULL;
  }

  // Check for fat/universal binary
  if (magic == 0xcafebabe || magic == 0xbebafeca) {
    // Fat binary - read first architecture
    uint32_t nfat_arch;
    if (fread(&nfat_arch, 1, sizeof(nfat_arch), f) != sizeof(nfat_arch)) {
      fclose(f);
      return NULL;
    }

    // Read first fat_arch structure
    uint32_t cputype;
    if (fread(&cputype, 1, sizeof(cputype), f) != sizeof(cputype)) {
      fclose(f);
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
      fclose(f);
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

  fclose(f);
  return NULL;
}

/**
 * Detect architecture from ELF binary
 */
static const char *detect_elf_architecture(const char *input_path) {
  FILE *f = fopen(input_path, "rb");
  if (!f) {
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
    if (fseek(f, phoff + i * phentsize, SEEK_SET) != 0) {
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
    fclose(f);
    fprintf(stderr, "Error: Cannot read magic bytes from binary\n");
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

  // Copy target to mutable buffer for parsing
  char buffer[128];
  if (strlen(target) >= sizeof(buffer)) {
    fprintf(stderr, "Error: Target string too long: %s\n", target);
    return -1;
  }
  snprintf(buffer, sizeof(buffer), "%s", target);

  // Parse platform-arch[-libc] format
  char *platform = strtok(buffer, "-");
  char *arch = strtok(NULL, "-");
  char *libc = strtok(NULL, "-");

  if (!platform || !arch) {
    fprintf(stderr, "Error: Invalid target format: %s (expected platform-arch[-libc])\n", target);
    return -1;
  }

  snprintf(out_platform, platform_size, "%s", platform);
  snprintf(out_arch, arch_size, "%s", arch);
  if (libc) {
    snprintf(out_libc, libc_size, "%s", libc);
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
  static char parsed_platform[16] = {0};
  static char parsed_arch[16] = {0};
  static char parsed_libc[16] = {0};

  // Priority 1: Parse combined target string if provided
  if (target) {
    if (parse_target_string(target,
                            parsed_platform, sizeof(parsed_platform),
                            parsed_arch, sizeof(parsed_arch),
                            parsed_libc, sizeof(parsed_libc)) != 0) {
      return NULL;
    }
    target_platform = parsed_platform;
    target_arch = parsed_arch;
    target_libc = parsed_libc[0] ? parsed_libc : NULL;
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
      fclose(f);
      fprintf(stderr, "Error: Cannot read magic bytes from binary\n");
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
  stub.platform = final_platform;
  stub.arch = final_arch;
  stub.libc = final_libc;

  if (strcmp(final_platform, "darwin") == 0) {
    if (strcmp(final_arch, "arm64") == 0) {
      stub.data = stub_darwin_arm64;
      stub.size = stub_darwin_arm64_len;
      return &stub;
    }
    if (strcmp(final_arch, "x64") == 0) {
      stub.data = stub_darwin_x64;
      stub.size = stub_darwin_x64_len;
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
      return &stub;
    }
    if (strcmp(final_arch, "x64") == 0) {
      stub.data = use_musl ? stub_linux_x64_musl : stub_linux_x64;
      stub.size = use_musl ? stub_linux_x64_musl_len : stub_linux_x64_len;
      stub.libc = use_musl ? "musl" : "glibc";
      return &stub;
    }
    fprintf(stderr, "Error: Unsupported Linux architecture: %s\n", final_arch);
    return NULL;
  }

  if (strcmp(final_platform, "win32") == 0) {
    if (strcmp(final_arch, "arm64") == 0) {
      stub.data = stub_win_arm64;
      stub.size = stub_win_arm64_len;
      return &stub;
    }
    if (strcmp(final_arch, "x64") == 0) {
      stub.data = stub_win_x64;
      stub.size = stub_win_x64_len;
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
    unlink(stub_path);
  }
}
