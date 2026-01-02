# Compilation rules for bin-infra shared sources.

$(BUILD_DIR)/compression_common.o: ../bin-infra/src/compression_common.c $(LZFSE_LIB) | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/file_io_common.o: ../bin-infra/src/file_io_common.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/smol_segment.o: ../bin-infra/src/smol_segment.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/smol_segment_reader.o: ../bin-infra/src/smol_segment_reader.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

# Generic C compilation rule.
$(BUILD_DIR)/%.o: $(SRC_DIR)/%.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

# Generic C++ compilation rule.
$(BUILD_DIR)/%.o: $(SRC_DIR)/%.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

# Directory creation.
$(BUILD_DIR) $(OUT_DIR):
	@mkdir -p $@
