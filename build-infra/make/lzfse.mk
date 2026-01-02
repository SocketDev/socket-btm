# LZFSE library paths and configuration.

LZFSE_UPSTREAM = ../bin-infra/upstream/lzfse
LZFSE_LIB = $(LZFSE_UPSTREAM)/build/bin/liblzfse.a
LZFSE_INCLUDE_DIR = $(LZFSE_UPSTREAM)/src

# LZFSE include flags.
LZFSE_CFLAGS = -I$(LZFSE_INCLUDE_DIR)

# LZFSE linker flags.
LZFSE_LDFLAGS = $(LZFSE_LIB)

# Build lzfse library if not already built.
$(LZFSE_LIB):
	@echo "Building lzfse library..."
	@$(MAKE) -C $(LZFSE_UPSTREAM) --no-print-directory
