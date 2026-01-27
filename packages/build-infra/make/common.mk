# Common definitions shared across all Makefiles.
# This file contains build settings that are identical across all platforms and tools.

# Project root: directory containing the Makefile (the package directory).
PROJECT_ROOT := $(shell pwd)

# Build mode: dev (default locally, fast builds) or prod (optimized for size/speed).
# Auto-detects CI environment and defaults accordingly:
# - Local: defaults to dev for fast iteration.
# - CI: defaults to prod for optimized releases.
ifdef CI
BUILD_MODE ?= prod
else
BUILD_MODE ?= dev
endif

# Version info: YYYYMMDD-commit format.
BUILD_DATE := $(shell date -u +"%Y%m%d")
BUILD_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
VERSION := $(BUILD_DATE)-$(BUILD_COMMIT)

# Build directory structure.
BUILD_MODE_DIR = build/$(BUILD_MODE)
BUILD_DIR = $(BUILD_MODE_DIR)
BIN_DIR = $(BUILD_MODE_DIR)/out/Final
OUT_DIR = $(BIN_DIR)

# Common infrastructure paths.
BUILD_INFRA_SRC = ../build-infra/src
BIN_INFRA_SRC = ../bin-infra/src
COMMON_INCLUDES = -I$(BUILD_INFRA_SRC) -I$(BIN_INFRA_SRC)

# Common phony targets.
.PHONY: all clean test check-tools install
