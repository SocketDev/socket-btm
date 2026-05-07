# Common rules for press/deflate compression tools.
# References pre-built binpress and binflate binaries from package directories.

# Package directories.
BINPRESS_DIR = ../../../../../../packages/binpress
BINFLATE_DIR = ../../../../../../packages/binflate

# Built binaries from packages (must be defined in platform-specific Makefile).
# COMPRESS_SOURCE = $(BINPRESS_DIR)/out/binpress or binpress.exe
# DECOMPRESS_SOURCE = $(BINFLATE_DIR)/out/binflate or binflate.exe

# Output directories.
OUT_COMPRESS = out/compress
OUT_DECOMPRESS = out/decompress

# Final targets (must be defined in platform-specific Makefile).
# COMPRESS = $(OUT_COMPRESS)/binpress or binpress.exe
# DECOMPRESS = $(OUT_DECOMPRESS)/binflate or binflate.exe

.PHONY: all clean build-packages

all: build-packages $(COMPRESS) $(DECOMPRESS)

build-packages:
	@echo "Building compression packages..."
	$(MAKE) -C $(BINPRESS_DIR)
	$(MAKE) -C $(BINFLATE_DIR)

$(COMPRESS): $(COMPRESS_SOURCE) | $(OUT_COMPRESS)
	cp $< $@

$(DECOMPRESS): $(DECOMPRESS_SOURCE) | $(OUT_DECOMPRESS)
	cp $< $@

$(OUT_COMPRESS) $(OUT_DECOMPRESS):
	mkdir -p $@

install: all
	@echo "Compression tools installed successfully"
	@echo "  - $(COMPRESS)"
	@echo "  - $(DECOMPRESS)"
