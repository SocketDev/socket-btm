# Compilation rules for bin-infra shared sources.

$(BUILD_DIR)/binary_format.o: $(BIN_INFRA_SRC)/binary_format.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/compression_common.o: $(BIN_INFRA_SRC)/compression_common.c $(LZFSE_LIB) | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/file_io_common.o: $(BUILD_INFRA_SRC)/file_io_common.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/file_utils.o: $(BUILD_INFRA_SRC)/file_utils.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/path_utils.o: $(BUILD_INFRA_SRC)/path_utils.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/tar_create.o: $(BUILD_INFRA_SRC)/tar_create.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/gzip_compress.o: $(BUILD_INFRA_SRC)/gzip_compress.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/stub_smol_repack_lief.o: $(BIN_INFRA_SRC)/stub_smol_repack_lief.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/smol_segment.o: $(BIN_INFRA_SRC)/smol_segment.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/smol_segment_reader.o: $(BIN_INFRA_SRC)/smol_segment_reader.c | $(BUILD_DIR)
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
