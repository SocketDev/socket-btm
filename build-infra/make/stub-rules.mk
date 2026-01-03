# Common compilation rules for smol_stub self-extracting binaries.
# Used by node-smol-builder stub Makefiles.

# Shared source file paths (relative to stub Makefile location).
BIN_INFRA_SRC = ../../../../../../packages/bin-infra/src
SMOL_SEGMENT_READER_SRC = $(BIN_INFRA_SRC)/smol_segment_reader.c
SMOL_SEGMENT_READER_OBJ = $(OUT_DIR)/smol_segment_reader.o

# Output directory.
OUT_DIR = out

# Common target.
TARGET_STUB_BASE = smol_stub

# Phony targets.
.PHONY: all clean install

# Build self-extracting stub.
# This stub is used by compress-binary.mjs to create self-extracting smol binaries.
all: $(OUT_DIR)/$(TARGET_STUB)

# Compile smol_segment_reader object file.
$(SMOL_SEGMENT_READER_OBJ): $(SMOL_SEGMENT_READER_SRC) | $(OUT_DIR)
	$(CC) $(CFLAGS) -c -o $@ $<

# Self-extracting stub (used during smol binary compression).
$(OUT_DIR)/$(TARGET_STUB): $(SOURCE_STUB) $(SMOL_SEGMENT_READER_OBJ) | $(OUT_DIR)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

$(OUT_DIR):
	mkdir -p $@

clean:
	rm -rf $(OUT_DIR)

install: all
	@echo "Self-extracting stub built successfully: $(OUT_DIR)/$(TARGET_STUB)"
