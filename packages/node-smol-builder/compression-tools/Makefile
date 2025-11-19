# Makefile for macOS compression tools
# Uses Apple Compression framework (LZFSE, LZMA, LZ4, ZLIB)

# Use system clang (not Homebrew's) to ensure proper SDK access
CC = /usr/bin/clang
CFLAGS = -O3 -Wall -Wextra -std=c11
# On modern macOS, Compression is provided as a library, not a framework
LDFLAGS = -lcompression

# Targets
COMPRESS = socketsecurity_macho_compress
DECOMPRESS = socketsecurity_macho_decompress

.PHONY: all clean

all: $(COMPRESS) $(DECOMPRESS)

$(COMPRESS): macho_compress.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)

$(DECOMPRESS): macho_decompress.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)

clean:
	rm -f $(COMPRESS) $(DECOMPRESS)
	rm -rf *.dSYM

install: all
	@echo "Compression tools built successfully"
	@echo "  - $(COMPRESS)"
	@echo "  - $(DECOMPRESS)"
