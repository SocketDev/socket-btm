# LIEF library paths and configuration.

LIEF_UPSTREAM = ../bin-infra/upstream/lief

# LIEF can come from two locations:
# 1. Downloaded from releases: ../build-infra/build/downloaded/lief/{platform-arch}/ (centralized)
# 2. Built from source: ../bin-infra/build/$(BUILD_MODE)/out/Final/lief/

# Detect platform-arch for downloaded location
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

# Normalize architecture name to match Node.js arch naming
# uname -m returns: x86_64, aarch64, etc.
# Node.js uses: x64, arm64, etc.
ifeq ($(UNAME_M),x86_64)
    ARCH := x64
else ifeq ($(UNAME_M),aarch64)
    ARCH := arm64
else
    ARCH := $(UNAME_M)
endif

ifeq ($(UNAME_S),Darwin)
    PLATFORM_ARCH := darwin-$(ARCH)
else ifeq ($(UNAME_S),Linux)
    # Check for musl
    IS_MUSL := $(shell ldd --version 2>&1 | grep -q musl && echo 1 || echo 0)
    ifeq ($(IS_MUSL),1)
        PLATFORM_ARCH := linux-$(ARCH)-musl
    else
        PLATFORM_ARCH := linux-$(ARCH)
    endif
else
    # Windows - use win32 for directory paths (asset names use 'win')
    PLATFORM_ARCH := win32-x64
endif

# Check centralized downloaded location first, then local build location
LIEF_DOWNLOADED_DIR = ../build-infra/build/downloaded/lief/$(PLATFORM_ARCH)
LIEF_BUILD_DIR = ../bin-infra/build/$(BUILD_MODE)/out/Final/lief

ifneq (,$(wildcard $(LIEF_DOWNLOADED_DIR)/libLIEF.a))
    LIEF_DIR = $(LIEF_DOWNLOADED_DIR)
else ifneq (,$(wildcard $(LIEF_DOWNLOADED_DIR)/LIEF.lib))
    LIEF_DIR = $(LIEF_DOWNLOADED_DIR)
else
    LIEF_DIR = $(LIEF_BUILD_DIR)
endif

LIEF_LIB = $(LIEF_DIR)/libLIEF.a

# LIEF include flags.
# Use upstream includes if submodule exists (building from source).
# Otherwise use downloaded includes from LIEF_DIR.
ifneq (,$(wildcard $(LIEF_UPSTREAM)/include))
    LIEF_CFLAGS = -I$(LIEF_UPSTREAM)/include -I$(LIEF_DIR)/include
else
    LIEF_CFLAGS = -I$(LIEF_DIR)/include
endif

# LIEF library is required for binject (except for clean and test targets).
ifneq ($(MAKECMDGOALS),clean)
ifneq ($(MAKECMDGOALS),test)
ifeq (,$(wildcard $(LIEF_LIB)))
    $(error LIEF library not found at $(LIEF_LIB). Please download LIEF from releases or build it first.)
endif
endif
endif

LIEF_LDFLAGS = $(LIEF_LIB)
LIEF_DEFINES = -DHAVE_LIEF=1
