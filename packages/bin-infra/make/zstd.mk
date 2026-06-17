# Vendored zstd library paths and configuration.
# Uses the zstd submodule at bin-infra/upstream/zstd for cross-platform builds.
# Compiles both compression and decompression (single-threaded, no ASM).

ZSTD_UPSTREAM = ../bin-infra/upstream/zstd
ZSTD_INCLUDE_DIR = $(ZSTD_UPSTREAM)/lib

# Target-specific build directories to avoid cross-compilation conflicts.
# Uses TARGET_ARCH (set by CI for cross-builds) or falls back to PLATFORM_ARCH or 'native'.
ifdef TARGET_ARCH
ZSTD_BUILD_SUFFIX = $(TARGET_ARCH)
else ifdef PLATFORM_ARCH
ZSTD_BUILD_SUFFIX = $(PLATFORM_ARCH)
else
ZSTD_BUILD_SUFFIX = native
endif
ZSTD_OBJ_DIR = $(ZSTD_UPSTREAM)/build/$(ZSTD_BUILD_SUFFIX)/obj
ZSTD_BIN_DIR = $(ZSTD_UPSTREAM)/build/$(ZSTD_BUILD_SUFFIX)/lib
ZSTD_LIB = $(ZSTD_BIN_DIR)/libzstd.a

# zstd include flags.
ZSTD_CFLAGS = -I$(ZSTD_INCLUDE_DIR)

# zstd linker flags.
ZSTD_LDFLAGS = $(ZSTD_LIB)

# Derive cross-compilation tools from CC prefix.
ZSTD_AR := $(if $(findstring -,$(CC)),$(patsubst %gcc,%,$(patsubst %clang,%,$(CC)))ar,ar)

# zstd source files (decompression + required common).
ZSTD_SRC_DIR = $(ZSTD_UPSTREAM)/lib
ZSTD_SOURCES = \
	common/debug.c \
	common/entropy_common.c \
	common/error_private.c \
	common/fse_decompress.c \
	common/xxhash.c \
	common/zstd_common.c \
	decompress/huf_decompress.c \
	decompress/zstd_ddict.c \
	decompress/zstd_decompress.c \
	decompress/zstd_decompress_block.c \
	compress/fse_compress.c \
	compress/hist.c \
	compress/huf_compress.c \
	compress/zstd_compress.c \
	compress/zstd_compress_literals.c \
	compress/zstd_compress_sequences.c \
	compress/zstd_compress_superblock.c \
	compress/zstd_double_fast.c \
	compress/zstd_fast.c \
	compress/zstd_lazy.c \
	compress/zstd_ldm.c \
	compress/zstd_opt.c \
	compress/zstd_preSplit.c \
	compress/zstdmt_compress.c
ZSTD_OBJECTS = $(addprefix $(ZSTD_OBJ_DIR)/,$(notdir $(ZSTD_SOURCES:.c=.o)))
# ARCH_FLAGS is set by platform-macos.mk for cross-compilation (e.g., -arch x86_64).
# ZSTD_DISABLE_ASM avoids requiring huf_decompress_amd64.S assembly on x86_64 Linux.
ZSTD_CFLAGS_BUILD = -O3 -Wall -DNDEBUG -UZSTD_MULTITHREAD -DZSTD_DISABLE_ASM -fvisibility=hidden $(ARCH_FLAGS)

# Build zstd library if not already built.
$(ZSTD_LIB): $(ZSTD_OBJECTS) | $(ZSTD_BIN_DIR)
	@echo "Creating zstd static library..."
	@$(ZSTD_AR) rcs $@ $(ZSTD_OBJECTS)

# Compile common sources.
$(ZSTD_OBJ_DIR)/%.o: $(ZSTD_SRC_DIR)/common/%.c | $(ZSTD_OBJ_DIR)
	@$(CC) $(ZSTD_CFLAGS_BUILD) $(ZSTD_CFLAGS) -c $< -o $@

# Compile decompress sources.
$(ZSTD_OBJ_DIR)/%.o: $(ZSTD_SRC_DIR)/decompress/%.c | $(ZSTD_OBJ_DIR)
	@$(CC) $(ZSTD_CFLAGS_BUILD) $(ZSTD_CFLAGS) -c $< -o $@

# Compile compress sources.
$(ZSTD_OBJ_DIR)/%.o: $(ZSTD_SRC_DIR)/compress/%.c | $(ZSTD_OBJ_DIR)
	@$(CC) $(ZSTD_CFLAGS_BUILD) $(ZSTD_CFLAGS) -c $< -o $@

$(ZSTD_OBJ_DIR):
	@mkdir -p $@

$(ZSTD_BIN_DIR):
	@mkdir -p $@
