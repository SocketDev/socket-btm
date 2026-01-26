# Makefile for stub unit tests.
#
# Usage:
#   make           - Build and run tests
#   make test      - Build and run tests
#   make clean     - Clean build artifacts

CC = cc
CFLAGS = -Wall -Wextra -std=c11 -g -I../src -I../../../../../../bin-infra/src

# Output directory.
OUT_DIR = out

# Test targets.
TESTS = update_config_test

.PHONY: all test clean

all: test

test: $(TESTS:%=$(OUT_DIR)/%)
	@echo ""
	@echo "Running tests..."
	@for test in $(TESTS:%=$(OUT_DIR)/%); do \
		./$$test || exit 1; \
	done

$(OUT_DIR)/update_config_test: update_config_test.c | $(OUT_DIR)
	$(CC) $(CFLAGS) -o $@ $<

$(OUT_DIR):
	mkdir -p $(OUT_DIR)

clean:
	rm -rf $(OUT_DIR)
