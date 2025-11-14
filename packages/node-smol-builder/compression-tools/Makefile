# Makefile for macOS compression tools
# Uses Apple Compression framework (LZFSE, LZMA, LZ4, ZLIB)

CC = clang
CFLAGS = -O3 -Wall -Wextra -std=c11
FRAMEWORKS = -framework Compression

# Targets
COMPRESS = socketsecurity_macho_compress
DECOMPRESS = socketsecurity_macho_decompress

.PHONY: all clean

all: $(COMPRESS) $(DECOMPRESS)

$(COMPRESS): macho_compress.c
	$(CC) $(CFLAGS) $(FRAMEWORKS) -o $@ $<

$(DECOMPRESS): macho_decompress.c
	$(CC) $(CFLAGS) $(FRAMEWORKS) -o $@ $<

clean:
	rm -f $(COMPRESS) $(DECOMPRESS)
	rm -rf *.dSYM

install: all
	@echo "Compression tools built successfully"
	@echo "  - $(COMPRESS)"
	@echo "  - $(DECOMPRESS)"
