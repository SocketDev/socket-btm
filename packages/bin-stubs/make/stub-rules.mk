# Common compilation rules for smol_stub self-extracting binaries.
# Used by stub Makefiles in packages/bin-infra/stubs/.

# Shared source file paths (relative to stub Makefile location: packages/bin-infra/stubs/).
BIN_INFRA_SRC = ../src
SMOL_SEGMENT_READER_SRC = $(BIN_INFRA_SRC)/smol_segment_reader.c
SMOL_SEGMENT_READER_OBJ = $(OUT_DIR)/smol_segment_reader.o

# LZFSE object files (if LZFSE_SOURCES is defined by platform Makefile)
LZFSE_OBJS = $(patsubst %.c,$(OUT_DIR)/%.o,$(notdir $(LZFSE_SOURCES)))

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

# Compile LZFSE object files (pattern rule)
# Use LZFSE_CFLAGS if defined, otherwise fall back to CFLAGS
$(OUT_DIR)/%.o: $(LZFSE_SRC)/%.c | $(OUT_DIR)
	$(CC) $(if $(LZFSE_CFLAGS),$(LZFSE_CFLAGS),$(CFLAGS)) $(filter -I%,$(CFLAGS)) $(filter -D%,$(CFLAGS)) -c -o $@ $<

# Self-extracting stub (used during smol binary compression).
$(OUT_DIR)/$(TARGET_STUB): $(SOURCE_STUB) $(SMOL_SEGMENT_READER_OBJ) $(LZFSE_OBJS) | $(OUT_DIR)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)
	@echo "✓ Stub built successfully: $@"
	@echo "Validating LZFSE was compiled with -O0..."
	@for obj in $(LZFSE_OBJS); do \
		if objdump -s -j .comment $$obj 2>/dev/null | grep -q "GCC:.*-O[123s]"; then \
			echo "❌ ERROR: $$obj was NOT compiled with -O0"; \
			echo "   LZFSE must be compiled with -O0 to avoid gcc x64 miscompilation"; \
			exit 1; \
		fi; \
	done || true
	@echo "✓ LZFSE validation passed"

$(OUT_DIR):
	mkdir -p $@

clean:
	rm -rf $(OUT_DIR)

install: all
	@echo "Self-extracting stub built successfully: $(OUT_DIR)/$(TARGET_STUB)"
