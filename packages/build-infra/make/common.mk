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
# PLATFORM_ARCH is set by JavaScript build scripts for platform isolation.
BUILD_MODE_DIR = build/$(BUILD_MODE)
ifdef PLATFORM_ARCH
BUILD_DIR = $(BUILD_MODE_DIR)/$(PLATFORM_ARCH)
else
BUILD_DIR = $(BUILD_MODE_DIR)
endif
BIN_DIR = $(BUILD_DIR)/out/Final
OUT_DIR = $(BIN_DIR)

# Common infrastructure paths.
BUILD_INFRA_SRC = ../build-infra/src/socketsecurity/build-infra
BIN_INFRA_SRC = ../bin-infra/src/socketsecurity/bin-infra
LIEF_BUILDER_SRC = ../lief-builder/src/socketsecurity/lief-builder
# Include paths point to src/ parent directories to support socketsecurity/ namespace prefix.
BUILD_INFRA_INCLUDE = ../build-infra/src
BIN_INFRA_INCLUDE = ../bin-infra/src
LIEF_BUILDER_INCLUDE = ../lief-builder/src
COMMON_INCLUDES = -I$(BUILD_INFRA_INCLUDE) -I$(BIN_INFRA_INCLUDE) -I$(LIEF_BUILDER_INCLUDE)

# Path-remap flags: anonymize absolute build-host paths in DWARF debug info
# and __FILE__ macros so shipped binaries don't leak the dev/CI machine's
# the dev's home dir, the dev's home dir, or project-root paths. Equivalent to the
# build-infra/lib/path-remap-flags.mts helper used by .mts build scripts.
# These are appended to OPT_FLAGS in each platform-*.mk so they reach every
# $(CC)/$(CXX) compile rule via $(CFLAGS)/$(CXXFLAGS).
PATH_REMAP_HOME := $(if $(HOME),$(HOME),$(shell echo $$HOME))
PATH_REMAP_CARGO_HOME := $(if $(CARGO_HOME),$(CARGO_HOME),$(PATH_REMAP_HOME)/.cargo)
PATH_REMAP_FLAGS := \
	-ffile-prefix-map=$(PATH_REMAP_CARGO_HOME)=/cargo \
	-ffile-prefix-map=$(PROJECT_ROOT)=/build \
	-ffile-prefix-map=$(PATH_REMAP_HOME)=/home

# Common phony targets.
.PHONY: all clean test check-tools install
