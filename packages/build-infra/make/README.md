# Shared Makefile Fragments

This directory contains shared Makefile fragments used by binject, binpress, binflate, and node-smol-builder packages to eliminate duplication and ensure consistency across platforms.

## Architecture

### Fragment Organization

```
build-infra/make/
├── binjected-rules.mk     # Common rules for binjected compression tools
├── bin-infra-rules.mk     # Common compilation rules for bin-infra sources
├── common.mk              # Universal build settings (all platforms)
├── lief.mk                # LIEF library paths and configuration
├── lzfse.mk               # LZFSE library paths and configuration
├── platform-linux.mk      # Linux-specific compiler/linker settings
├── platform-macos.mk      # macOS-specific compiler/linker settings
├── platform-windows.mk    # Windows-specific compiler/linker settings
└── stub-rules.mk          # Common rules for smol_stub self-extracting binaries
```

## Fragment Descriptions

### common.mk

Universal build settings shared across all platforms:

- **Build mode detection**: Auto-detects CI environment (dev locally, prod in CI)
- **Version generation**: YYYYMMDD-commit format from git
- **Directory structure**: Consistent build/dev, build/prod, build/*/out/Final paths
- **Common includes**: -I../build-infra/src -I../bin-infra/src
- **Phony targets**: .PHONY declarations

**Variables provided:**
- `BUILD_MODE`: dev or prod
- `VERSION`: YYYYMMDD-commit
- `BUILD_DIR`, `BIN_DIR`, `OUT_DIR`: Build output directories
- `COMMON_INCLUDES`: Common include paths

### platform-linux.mk

Linux-specific build settings:

- **Compiler**: `gcc`/`g++` (overridable via CC/CXX env vars)
- **Optimization**: -Os for prod, -O0 for dev
- **Stripping**: Post-build `strip` command (preserves pthread symbols)
- **Linker flags**: `-static -llzma -Wl,--gc-sections`
- **Clean implementation**: Linux-style find commands

**Variables provided:**
- `CC`, `CXX`: Compiler binaries
- `OPT_FLAGS`: Optimization flags
- `LDFLAGS_BASE`: Base linker flags

**Macros provided:**
- `STRIP_BINARY`: Post-build stripping command
- `CLEAN_IMPL`: Platform-specific clean implementation

### platform-macos.mk

macOS-specific build settings:

- **Compiler**: `/usr/bin/clang` and `/usr/bin/clang++`
- **Optimization**: -Os -s for prod, -O0 for dev
- **POSIX macros**: -D_POSIX_C_SOURCE=200809L -D_XOPEN_SOURCE=700
- **LZMA paths**: Homebrew xz package detection
- **Linker flags**: `-lcompression -L$(LZMA_LIB) -llzma -Wl,-dead_strip`
- **Binary signing**: Ad-hoc codesign for Node.js spawn compatibility

**Variables provided:**
- `CC`, `CXX`: Compiler binaries
- `OPT_FLAGS`: Optimization flags with -s
- `POSIX_MACROS`: POSIX feature macros
- `LZMA_INCLUDE`, `LZMA_LIB`: liblzma paths
- `LDFLAGS_BASE`: Base linker flags

**Macros provided:**
- `SIGN_BINARY`: macOS ad-hoc codesigning
- `CLEAN_IMPL`: Platform-specific clean implementation

### platform-windows.mk

Windows-specific build settings:

- **Compiler**: `gcc`/`g++` (MinGW, overridable via CC/CXX)
- **Optimization**: -Os -s for prod, -O0 for dev
- **Linker flags**: `-Wl,--gc-sections -lcabinet`
- **Cabinet.dll**: Import library generation via dlltool
- **Clean implementation**: Windows-compatible find commands

**Variables provided:**
- `CC`, `CXX`: Compiler binaries
- `OPT_FLAGS`: Optimization flags
- `LDFLAGS_BASE`: Base linker flags
- `IMPORT_LIB`: Cabinet.dll import library path

**Macros provided:**
- `CHECK_TOOLS_EXTRA`: Windows-specific tool checks (dlltool)
- `CLEAN_IMPL`: Platform-specific clean implementation

### lief.mk

LIEF library configuration:

- **Paths**: Upstream source and mode-specific build directory
- **Conditional inclusion**: Only links if libLIEF.a exists
- **Cross-platform**: Works on Linux, macOS, and Windows

**Variables provided:**
- `LIEF_UPSTREAM`, `LIEF_BUILD_DIR`, `LIEF_LIB`, `LIEF_INCLUDE_DIR`: LIEF paths
- `LIEF_CFLAGS`: Include paths for LIEF headers
- `LIEF_LDFLAGS`: LIEF library linker flag
- `LIEF_DEFINES`: -DHAVE_LIEF=1 if library exists

### lzfse.mk

LZFSE library configuration:

- **Paths**: Upstream source and built static library
- **Usage**: Linux/Windows for cross-platform Mach-O compression (macOS uses native Apple Compression framework)

**Variables provided:**
- `LZFSE_UPSTREAM`, `LZFSE_LIB`, `LZFSE_INCLUDE_DIR`: LZFSE paths
- `LZFSE_CFLAGS`: Include path for lzfse.h
- `LZFSE_LDFLAGS`: LZFSE library linker flag

### bin-infra-rules.mk

Common compilation rules for shared bin-infra sources:

- **C compilation**: Generic pattern rule for .c → .o
- **C++ compilation**: Generic pattern rule for .cpp → .o
- **bin-infra sources**: Rules for compression_common.c, file_io_common.c, smol_segment.c, smol_segment_reader.c
- **Directory creation**: Build and output directories

### stub-rules.mk

Common rules for smol_stub self-extracting binaries:

- **Purpose**: Used by node-smol-builder to create self-extracting Node.js binaries
- **Common sources**: smol_segment_reader.c compilation rules
- **Output directory**: out/ directory creation
- **Build targets**: Compiles platform-specific stub (elf_stub.c, macho_stub.c, pe_stub.c)
- **Variables required**: SOURCE_STUB, TARGET_STUB (defined in platform-specific Makefile)

**Usage pattern:**
```makefile
# Define platform-specific variables
SOURCE_STUB = src/elf_stub.c
TARGET_STUB = smol_stub
CFLAGS = -Os -s -Wall -Wextra -std=c11 ...
LDFLAGS = -static ...

# Include common rules
include ../../../../../build-infra/make/stub-rules.mk
```

### binjected-rules.mk

Common rules for binjected compression tools:

- **Purpose**: References pre-built binpress and binflate binaries for node-smol-builder
- **Package integration**: Builds binpress and binflate, then copies to output directories
- **Output structure**: out/compress/ and out/decompress/ directories
- **Variables required**: COMPRESS_SOURCE, DECOMPRESS_SOURCE, COMPRESS, DECOMPRESS (defined in platform-specific Makefile)

**Usage pattern:**
```makefile
# Define platform-specific binary paths
COMPRESS_SOURCE = $(BINPRESS_DIR)/out/binpress
DECOMPRESS_SOURCE = $(BINFLATE_DIR)/out/binflate
COMPRESS = $(OUT_COMPRESS)/binpress
DECOMPRESS = $(OUT_DECOMPRESS)/binflate

# Include common rules
include ../../../../../build-infra/make/binjected-rules.mk

# Add platform-specific clean
clean:
	rm -rf out/
	$(MAKE) -C $(BINPRESS_DIR) clean
	$(MAKE) -C $(BINFLATE_DIR) clean
```

## Usage Example

### Minimal Package Makefile

```makefile
# Include common definitions.
include ../../build-infra/make/common.mk
include ../../build-infra/make/platform-linux.mk
include ../../build-infra/make/lief.mk
include ../../build-infra/make/lzfse.mk

TARGET = mytool
SRC_DIR = src

# Source files.
SRCS = $(SRC_DIR)/main.c ../bin-infra/src/compression_common.c
OBJS = $(BUILD_DIR)/main.o $(BUILD_DIR)/compression_common.o

# Compiler flags.
CFLAGS := -Wall -Wextra $(OPT_FLAGS) -std=c11 $(COMMON_INCLUDES) $(LZFSE_CFLAGS) -DVERSION=\"$(VERSION)\" $(CFLAGS)
LDFLAGS := $(LDFLAGS_BASE) $(LZFSE_LDFLAGS) $(LIEF_LDFLAGS) $(LDFLAGS)

# Build target.
all: $(BIN_DIR)/$(TARGET)

$(BIN_DIR)/$(TARGET): $(OBJS) | $(BIN_DIR)
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(LDFLAGS)
	$(call STRIP_BINARY,$@)
	@echo "Built: $(BIN_DIR)/$(TARGET)"

# Include common compilation rules.
include ../../build-infra/make/bin-infra-rules.mk

clean:
	$(call CLEAN_IMPL,mytool)
```

## Benefits

### Code Reduction

**binject/binpress/binflate packages:**
- Before refactoring: 1,654 lines across 9 Makefiles
- After refactoring: 595 lines across 9 Makefiles
- Reduction: 1,059 lines (64%)

**node-smol-builder packages:**
- Before refactoring: 272 lines across 6 Makefiles
- After refactoring: 95 lines across 6 Makefiles
- Reduction: 177 lines (65%)

**Total impact:**
- Before refactoring: 1,926 lines across 15 Makefiles
- After refactoring: 690 lines across 15 Makefiles
- Reduction: 1,236 lines (64%)

### Maintainability

- **Single source of truth**: Build settings defined once, used everywhere
- **Consistent behavior**: Same optimization flags, stripping strategy, etc. across all packages
- **Easy updates**: Change platform-*.mk once, affects all packages
- **No duplication**: Build mode detection, version generation, directory structure all shared

### Safety

- **No copy-paste errors**: Can't have mismatched settings between packages
- **Platform-specific**: Each platform gets correct compiler flags, linker flags, etc.
- **Tested patterns**: All settings verified working on real builds

## Adding New Packages

To add a new package using these fragments:

1. Create package Makefile (e.g., `packages/newtool/Makefile.linux`)
2. Include appropriate fragments at the top:
   ```makefile
   include ../../build-infra/make/common.mk
   include ../../build-infra/make/platform-linux.mk
   ```
3. Define package-specific variables (TARGET, SRCS, OBJS)
4. Set compiler flags using provided variables:
   ```makefile
   CFLAGS := -Wall -Wextra $(OPT_FLAGS) -std=c11 $(COMMON_INCLUDES) -DVERSION=\"$(VERSION)\" $(CFLAGS)
   ```
5. Include bin-infra-rules.mk for common compilation rules
6. Use provided macros: `$(call STRIP_BINARY,$@)`, `$(call CLEAN_IMPL,newtool)`

## Platform-Specific Notes

### Linux

- Environment variable support: CFLAGS, CXXFLAGS, LDFLAGS can be overridden for musl builds
- Static linking by default: -static, -static-libstdc++, -static-libgcc
- Post-build stripping: Uses plain `strip` command to preserve pthread symbols

### macOS

- Fixed compiler paths: /usr/bin/clang, /usr/bin/clang++
- Homebrew detection: Automatically finds xz package for liblzma
- Binary signing: Ad-hoc codesign required for Node.js child_process.spawn
- Native compression: Uses Apple Compression framework (no lzfse library needed)

### Windows

- MinGW toolchain: gcc/g++ for consistent ABI with LIEF
- Cabinet.dll: Import library generated via dlltool
- Static linking: -static-libgcc, -static-libstdc++ to avoid missing DLLs
- Socket library: -lws2_32 for network functions (inet_pton)

## Troubleshooting

### Build fails with "command not found"

Check that required tools are available:
- Linux: gcc, g++, make
- macOS: clang, make
- Windows: gcc, g++, make, dlltool

### Library not found errors

Ensure libraries are built first:
- LIEF: `cd packages/bin-infra && make -f Makefile.<platform> lief`
- LZFSE: `cd packages/bin-infra/upstream/lzfse && make`

### Include path errors

Verify directory structure:
- Fragments must be in `build-infra/make/`
- Packages must include with `../../build-infra/make/`
- bin-infra must be sibling directory: `../bin-infra/`

### Platform-specific issues

Check platform-*.mk for correct settings:
- Compiler paths (especially macOS)
- Library paths (especially LZMA on macOS)
- Linker flags (static linking, symbol visibility)
