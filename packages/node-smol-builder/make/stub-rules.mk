# Common compilation rules for smol_stub self-extracting binaries.
# Used by stub Makefiles in packages/bin-infra/stubs/.

# Shared source file paths (relative to stub Makefile location: packages/bin-infra/stubs/).
BIN_INFRA_SRC = ../src
SMOL_SEGMENT_READER_SRC = $(BIN_INFRA_SRC)/smol_segment_reader.c
SMOL_SEGMENT_READER_OBJ = $(OUT_DIR)/smol_segment_reader.o

# Output directory.
OUT_DIR = out

# Common target.
TARGET_STUB_BASE = smol_stub

# Phony targets.
.PHONY: all clean install

# Build self-extracting stub.
# This stub is used by compress-binary.mts to create self-extracting smol binaries.
all: $(OUT_DIR)/$(TARGET_STUB)

# Compile smol_segment_reader object file.
$(SMOL_SEGMENT_READER_OBJ): $(SMOL_SEGMENT_READER_SRC) | $(OUT_DIR)
	$(CC) $(CFLAGS) -c -o $@ $<

# Self-extracting stub (used during smol binary compression).
$(OUT_DIR)/$(TARGET_STUB): $(SOURCE_STUB) $(SMOL_SEGMENT_READER_OBJ) | $(OUT_DIR)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)
	@echo "√ Stub built successfully: $@"

$(OUT_DIR):
	mkdir -p $@

clean:
	rm -rf $(OUT_DIR)

install: all
	@echo "Self-extracting stub built successfully: $(OUT_DIR)/$(TARGET_STUB)"
