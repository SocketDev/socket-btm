# binject Makefile
# Simple, portable build for macOS/Linux/Windows

# Detect OS
UNAME_S := $(shell uname -s)

# Platform-specific settings
ifeq ($(UNAME_S),Darwin)
    # macOS - Simple C implementation, no LIEF required
    CC = /usr/bin/clang
    CXX = /usr/bin/clang++
    CFLAGS = -Wall -Wextra -Os -s -std=c11 -I../bin-infra/src
    CXXFLAGS = -Wall -Wextra -Os -s -std=c++17 -I../bin-infra/src
    LDFLAGS = -lcompression -Wl,-dead_strip
else ifeq ($(UNAME_S),Linux)
    # Linux - Still uses LIEF for ELF (for now)
    CC = gcc
    CXX = g++
    CFLAGS = -Wall -Wextra -Os -s -std=c11 -I../bin-infra/src
    CXXFLAGS = -Wall -Wextra -Os -s -std=c++17 -I../bin-infra/src
    LDFLAGS = -llzma -Wl,--gc-sections
else
    # Windows - Still uses LIEF for PE (for now)
    CC = gcc
    CXX = g++
    CFLAGS = -Wall -Wextra -Os -s -std=c11 -I../bin-infra/src
    CXXFLAGS = -Wall -Wextra -Os -s -std=c++17 -I../bin-infra/src
    LDFLAGS = -lcabinet -lkernel32 -Wl,--gc-sections
endif

TARGET = binject
BUILD_DIR = build
BIN_DIR = bin
SRC_DIR = src
TEST_DIR = test

# Source files
SRCS = $(SRC_DIR)/main.c $(SRC_DIR)/binject.c $(SRC_DIR)/macho_inject_simple.c $(SRC_DIR)/macho_inject_segedit.c $(SRC_DIR)/elf_inject_stub.c $(SRC_DIR)/pe_inject_stub.c ../bin-infra/src/compression_common.c
OBJS = $(BUILD_DIR)/main.o $(BUILD_DIR)/binject.o $(BUILD_DIR)/macho_inject_simple.o $(BUILD_DIR)/macho_inject_segedit.o $(BUILD_DIR)/elf_inject_stub.o $(BUILD_DIR)/pe_inject_stub.o $(BUILD_DIR)/compression_common.o

# Test files
TEST_SRCS = $(TEST_DIR)/binject_test.c $(SRC_DIR)/binject.c $(SRC_DIR)/macho_inject_simple.c $(SRC_DIR)/macho_inject_segedit.c $(SRC_DIR)/elf_inject_stub.c $(SRC_DIR)/pe_inject_stub.c ../bin-infra/src/compression_common.c
TEST_OBJS = $(BUILD_DIR)/binject_test.o $(BUILD_DIR)/binject.o $(BUILD_DIR)/macho_inject_simple.o $(BUILD_DIR)/macho_inject_segedit.o $(BUILD_DIR)/elf_inject_stub.o $(BUILD_DIR)/pe_inject_stub.o $(BUILD_DIR)/compression_common.o
TEST_TARGET = $(BUILD_DIR)/binject_test

.PHONY: check-tools

# Check that required build tools are available
check-tools:
	@command -v $(CC) >/dev/null 2>&1 || { echo "ERROR: $(CC) not found. Install build tools first."; exit 1; }
	@command -v $(CXX) >/dev/null 2>&1 || { echo "ERROR: $(CXX) not found. Install build tools first."; exit 1; }
	@command -v make >/dev/null 2>&1 || { echo "ERROR: make not found"; exit 1; }

# Default target
all: check-tools $(BIN_DIR)/$(TARGET)

# Create directories
$(BUILD_DIR) $(BIN_DIR):
	@mkdir -p $@

# Build binary
$(BIN_DIR)/$(TARGET): $(OBJS) | $(BIN_DIR)
ifeq ($(UNAME_S),Darwin)
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(LDFLAGS)
else
	$(CXX) $(CXXFLAGS) -o $@ $(OBJS) $(LDFLAGS)
endif
	@echo "Built: $(BIN_DIR)/$(TARGET)"

# Compile C files
$(BUILD_DIR)/%.o: $(SRC_DIR)/%.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

# Compile C++ files
$(BUILD_DIR)/%.o: $(SRC_DIR)/%.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

# Compile compression_common from bin-infra
$(BUILD_DIR)/compression_common.o: ../bin-infra/src/compression_common.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

# Clean build artifacts
clean:
	rm -rf $(BUILD_DIR)
	rm -rf $(BIN_DIR)

# Install (optional, for system-wide use)
install: $(BIN_DIR)/$(TARGET)
	install -m 755 $(BIN_DIR)/$(TARGET) /usr/local/bin/

# Uninstall
uninstall:
	rm -f /usr/local/bin/$(TARGET)

# Build test binary
$(TEST_TARGET): $(TEST_OBJS)
ifeq ($(UNAME_S),Darwin)
	$(CC) $(CFLAGS) -o $@ $(TEST_OBJS) $(LDFLAGS)
else
	$(CXX) $(CXXFLAGS) -o $@ $(TEST_OBJS) $(LDFLAGS)
endif
	@echo "Built: $(TEST_TARGET)"

# Compile test source
$(BUILD_DIR)/binject_test.o: $(TEST_DIR)/binject_test.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

# Run tests
test: $(TEST_TARGET)
	@echo "\nRunning binject tests..."
	@$(TEST_TARGET)

# Coverage target - build with coverage instrumentation and generate reports
COVERAGE_DIR = coverage
COVERAGE_CFLAGS = $(CFLAGS) -fprofile-arcs -ftest-coverage -O0 -g
COVERAGE_CXXFLAGS = $(CXXFLAGS) -fprofile-arcs -ftest-coverage -O0 -g
COVERAGE_LDFLAGS = $(LDFLAGS) -fprofile-arcs -ftest-coverage

$(BUILD_DIR)/coverage_%.o: $(SRC_DIR)/%.c | $(BUILD_DIR)
	$(CC) $(COVERAGE_CFLAGS) -c $< -o $@

$(BUILD_DIR)/coverage_compression_common.o: ../bin-infra/src/compression_common.c | $(BUILD_DIR)
	$(CC) $(COVERAGE_CFLAGS) -c $< -o $@

$(BUILD_DIR)/coverage_binject_test.o: $(TEST_DIR)/binject_test.c | $(BUILD_DIR)
	$(CC) $(COVERAGE_CFLAGS) -c $< -o $@

$(BUILD_DIR)/coverage_macho_inject_simple.o: $(SRC_DIR)/macho_inject_simple.c | $(BUILD_DIR)
	$(CC) $(COVERAGE_CFLAGS) -c $< -o $@

$(BUILD_DIR)/coverage_macho_inject_segedit.o: $(SRC_DIR)/macho_inject_segedit.c | $(BUILD_DIR)
	$(CC) $(COVERAGE_CFLAGS) -c $< -o $@

$(BUILD_DIR)/coverage_elf_inject_stub.o: $(SRC_DIR)/elf_inject_stub.c | $(BUILD_DIR)
	$(CC) $(COVERAGE_CFLAGS) -c $< -o $@

$(BUILD_DIR)/coverage_pe_inject_stub.o: $(SRC_DIR)/pe_inject_stub.c | $(BUILD_DIR)
	$(CC) $(COVERAGE_CFLAGS) -c $< -o $@

$(BUILD_DIR)/binject_test_coverage: $(BUILD_DIR)/coverage_binject_test.o $(BUILD_DIR)/coverage_binject.o $(BUILD_DIR)/coverage_macho_inject_simple.o $(BUILD_DIR)/coverage_macho_inject_segedit.o $(BUILD_DIR)/coverage_elf_inject_stub.o $(BUILD_DIR)/coverage_pe_inject_stub.o $(BUILD_DIR)/coverage_compression_common.o
	$(CC) $(COVERAGE_CFLAGS) -o $@ $^ $(COVERAGE_LDFLAGS)

cover: $(BUILD_DIR)/binject_test_coverage | $(COVERAGE_DIR)
	@echo "Running tests with coverage..."
	@$(BUILD_DIR)/binject_test_coverage
	@echo "\nGenerating coverage report..."
	@gcov -o $(BUILD_DIR) $(SRC_DIR)/binject.c ../bin-infra/src/compression_common.c
	@mkdir -p $(COVERAGE_DIR)
	@mv *.gcov $(COVERAGE_DIR)/ 2>/dev/null || true
	@echo "\nCoverage Summary:"
	@echo "================="
	@grep -A 3 "File.*binject.c" $(COVERAGE_DIR)/binject.c.gcov | head -4 || echo "binject.c coverage data not found"
	@grep -A 3 "File.*compression_common.c" $(COVERAGE_DIR)/compression_common.c.gcov | head -4 || echo "compression_common.c coverage data not found"
	@echo "\nDetailed reports in $(COVERAGE_DIR)/"

$(COVERAGE_DIR):
	@mkdir -p $@

clean-coverage:
	rm -rf $(COVERAGE_DIR)
	rm -f $(BUILD_DIR)/*.gcda $(BUILD_DIR)/*.gcno
	rm -f *.gcov

.PHONY: all clean install uninstall test cover clean-coverage
