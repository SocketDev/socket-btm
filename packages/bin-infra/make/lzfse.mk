# LZFSE library paths and configuration.
# Note: macOS has native LZFSE support via Apple Compression framework (-lcompression).

LZFSE_UPSTREAM = ../bin-infra/upstream/lzfse
LZFSE_LIB = $(LZFSE_UPSTREAM)/build/bin/liblzfse.a
LZFSE_INCLUDE_DIR = $(LZFSE_UPSTREAM)/src

# LZFSE include flags.
LZFSE_CFLAGS = -I$(LZFSE_INCLUDE_DIR)

# LZFSE linker flags.
LZFSE_LDFLAGS = $(LZFSE_LIB)

# Derive cross-compilation tools from CC prefix (e.g., aarch64-w64-mingw32-gcc -> aarch64-w64-mingw32-).
# This ensures AR matches the cross-compiler for ARM64 Windows builds.
# Only extract prefix if CC contains a hyphen (indicates cross-compiler like aarch64-w64-mingw32-gcc).
LZFSE_AR := $(if $(findstring -,$(CC)),$(patsubst %gcc,%,$(patsubst %clang,%,$(CC)))ar,ar)

# LZFSE source files and objects.
LZFSE_SRC_DIR = $(LZFSE_UPSTREAM)/src
LZFSE_OBJ_DIR = $(LZFSE_UPSTREAM)/build/obj
LZFSE_BIN_DIR = $(LZFSE_UPSTREAM)/build/bin
LZFSE_SOURCES = lzfse_encode.c lzfse_decode.c lzfse_encode_base.c lzfse_decode_base.c lzvn_encode_base.c lzvn_decode_base.c lzfse_fse.c
LZFSE_OBJECTS = $(addprefix $(LZFSE_OBJ_DIR)/,$(LZFSE_SOURCES:.c=.o))
LZFSE_CFLAGS_BUILD = -O0 -Wall -Wno-unknown-pragmas -Wno-unused-variable -DNDEBUG -D_POSIX_C_SOURCE -std=c99 -fvisibility=hidden

# Build lzfse library if not already built.
# Build objects directly and use ar to create library (avoids ld -r which LLD doesn't support).
$(LZFSE_LIB): $(LZFSE_OBJECTS) | $(LZFSE_BIN_DIR)
	@echo "Creating lzfse static library..."
	@$(LZFSE_AR) rcs $@ $(LZFSE_OBJECTS)

$(LZFSE_OBJ_DIR)/%.o: $(LZFSE_SRC_DIR)/%.c | $(LZFSE_OBJ_DIR)
	@$(CC) $(LZFSE_CFLAGS_BUILD) -c $< -o $@

$(LZFSE_OBJ_DIR):
	@mkdir -p $@

$(LZFSE_BIN_DIR):
	@mkdir -p $@
