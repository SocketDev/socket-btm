# Makefile for smol_stub - minimal launcher that extracts and calls binflate
# Platform-agnostic - detects OS and builds appropriate binary

UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
    # macOS - Minimal stub using shared code from bin-infra
    CC = /usr/bin/clang
    OPENSSL_PREFIX = $(shell brew --prefix openssl@3 2>/dev/null || brew --prefix openssl 2>/dev/null || echo "/usr/local")
    CFLAGS = -Os -s -Wall -Wextra -std=c11 -I../../../../../bin-infra/src -I$(OPENSSL_PREFIX)/include
    LDFLAGS = -L$(OPENSSL_PREFIX)/lib -lssl -lcrypto -lcompression -Wl,-dead_strip
    SOURCE_STUB = src/macho_stub.c
    TARGET_STUB = smol_stub
else ifeq ($(UNAME_S),Linux)
    # Linux - Minimal stub using shared code from bin-infra
    CC = gcc
    CFLAGS = -Os -s -Wall -Wextra -std=c11 -I../../../../../bin-infra/src
    LDFLAGS = -static -llzma -lssl -lcrypto -ldl -lpthread -Wl,--gc-sections
    SOURCE_STUB = src/elf_stub.c
    TARGET_STUB = smol_stub
else
    # Windows - Minimal stub using shared code from bin-infra
    CC = gcc
    CFLAGS = -Os -s -Wall -Wextra -std=c11 -I../../../../../bin-infra/src
    LDFLAGS = -lcabinet -lssl -lcrypto -Wl,--gc-sections
    SOURCE_STUB = src/pe_stub.c
    TARGET_STUB = smol_stub.exe
endif

# Output directories
OUT_DIR = out

.PHONY: all clean install

# Build self-extracting stub
# This stub is used by compress-binary.mjs to create self-extracting smol binaries
all: $(OUT_DIR)/$(TARGET_STUB)

# Self-extracting stub (used during smol binary compression)
$(OUT_DIR)/$(TARGET_STUB): $(SOURCE_STUB) | $(OUT_DIR)
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)

$(OUT_DIR):
	mkdir -p $@

clean:
	rm -rf $(OUT_DIR)

install: all
	@echo "Self-extracting stub built successfully: $(OUT_DIR)/$(TARGET_STUB)"
