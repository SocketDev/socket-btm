# Makefile for smol_stub - minimal launcher that extracts and calls binflate
# Platform-agnostic - detects OS and builds appropriate binary

UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
    # macOS - Minimal stub using shared code from bin-infra
    CC ?= /usr/bin/clang
    OPENSSL_PREFIX = $(shell brew --prefix openssl@3 2>/dev/null || brew --prefix openssl 2>/dev/null || echo "/usr/local")
    # Support cross-compilation via TARGET_ARCH environment variable (x64 = x86_64, arm64 = arm64)
    ARCH_FLAG = $(if $(TARGET_ARCH),-arch $(subst x64,x86_64,$(TARGET_ARCH)),)
    CFLAGS = -Os -s -Wall -Wextra -std=c11 $(ARCH_FLAG) -I../../../../../bin-infra/src -I$(OPENSSL_PREFIX)/include
    LDFLAGS = -L$(OPENSSL_PREFIX)/lib -lssl -lcrypto -lcompression -Wl,-dead_strip
    SOURCE_STUB = src/macho_stub.c
    TARGET_STUB = smol_stub
else ifeq ($(UNAME_S),Linux)
    # Linux - Minimal stub using shared code from bin-infra
    # CFLAGS/LDFLAGS can be set via environment (e.g., for musl include/lib paths)
    CC ?= gcc
    CFLAGS := -Os -s -Wall -Wextra -std=c11 -I../../../../../bin-infra/src $(CFLAGS)
    LDFLAGS := -static -lssl -lcrypto -llzma -Wl,--gc-sections $(LDFLAGS)
    SOURCE_STUB = src/elf_stub.c
    TARGET_STUB = smol_stub
else
    # Windows - Minimal stub using shared code from bin-infra
    # Note: CC can be overridden via environment variables (e.g., clang in CI)
    CC ?= gcc
    CFLAGS = -Os -Wall -Wextra -std=c11 -I../../../../../bin-infra/src -D_CRT_SECURE_NO_WARNINGS
    LDFLAGS = -L$(OUT_DIR) -lcabinet -ladvapi32 -lshell32 -Wl,--gc-sections
    SOURCE_STUB = src/pe_stub.c
    TARGET_STUB = smol_stub.exe
    IMPORT_LIB = $(OUT_DIR)/libcabinet.a
endif

# Output directories
OUT_DIR = out

.PHONY: all clean install

# Build self-extracting stub
# This stub is used by compress-binary.mjs to create self-extracting smol binaries
all: $(OUT_DIR)/$(TARGET_STUB)

# Generate Cabinet.dll import library on Windows
ifdef IMPORT_LIB
$(IMPORT_LIB): cabinet.def | $(OUT_DIR)
	dlltool -d cabinet.def -l $@

$(OUT_DIR)/$(TARGET_STUB): $(IMPORT_LIB)
endif

# Self-extracting stub (used during smol binary compression)
$(OUT_DIR)/$(TARGET_STUB): $(SOURCE_STUB) | $(OUT_DIR)
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)

$(OUT_DIR):
	mkdir -p $@

clean:
	rm -rf $(OUT_DIR)

install: all
	@echo "Self-extracting stub built successfully: $(OUT_DIR)/$(TARGET_STUB)"
