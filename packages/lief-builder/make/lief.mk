# LIEF library paths and configuration.
# LIEF is built by this package (lief-builder).
#
# Path-of-truth (CLAUDE.md "1 path, 1 reference"):
#   - PLATFORM_ARCH env var (e.g. "win32-arm64") is the single source.
#     The set-platform-arch GitHub Action emits it; the JavaScript
#     build scripts pass it through; common.mk reads it for the
#     `build/<mode>/<PLATFORM_ARCH>/` layout that ALL packages share.
#   - lief-builder ITSELF and every consumer that `include`s this
#     file see the same value via the same env var.
#   - When PLATFORM_ARCH is unset (local dev outside CI), fall back
#     to a shell-side detector that produces the same string shape
#     (canonical fleet form, validated by parsePlatformArch in
#     build-infra/lib/platform-mappings.mts: darwin-{x64,arm64} /
#     linux-{x64,arm64}[-musl] / win32-{x64,arm64}).

# Path to lief-builder package root (relative to package Makefiles that include this file).
# Don't use $(lastword $(MAKEFILE_LIST)) - it may not be this file if other .mk files are included after.
# All packages that include lief.mk are in packages/*/ so lief-builder is always at ../lief-builder.
LIEF_BUILDER_ROOT = ../lief-builder

LIEF_UPSTREAM = $(LIEF_BUILDER_ROOT)/upstream/lief

# LIEF can come from two locations:
# 1. Downloaded from releases: lief-builder/build/downloaded/lief/{platform-arch}/
# 2. Built from source: lief-builder/build/$(BUILD_MODE)/<platform-arch>/out/Final/lief/

ifndef PLATFORM_ARCH
    # Local-dev fallback. Detect from `uname` plus optional TARGET_ARCH
    # override for cross-compile. CI always sets PLATFORM_ARCH explicitly
    # (set-platform-arch GitHub Action), so this branch only fires
    # outside the workflow harness.
    UNAME_S := $(shell uname -s)
    UNAME_M := $(shell uname -m)
    ifeq ($(UNAME_M),x86_64)
        ARCH := x64
    else ifeq ($(UNAME_M),aarch64)
        ARCH := arm64
    else
        ARCH := $(UNAME_M)
    endif

    ifeq ($(UNAME_S),Darwin)
        ifdef TARGET_ARCH
            ifeq ($(TARGET_ARCH),arm64)
                PLATFORM_ARCH := darwin-arm64
            else ifeq ($(TARGET_ARCH),aarch64)
                PLATFORM_ARCH := darwin-arm64
            else
                PLATFORM_ARCH := darwin-x64
            endif
        else
            PLATFORM_ARCH := darwin-$(ARCH)
        endif
    else ifeq ($(UNAME_S),Linux)
        IS_MUSL := $(shell ldd --version 2>&1 | grep -q musl && echo 1 || echo 0)
        ifeq ($(IS_MUSL),1)
            PLATFORM_ARCH := linux-$(ARCH)-musl
        else
            PLATFORM_ARCH := linux-$(ARCH)
        endif
    else
        # Windows — emit the canonical win32-prefixed form that
        # parsePlatformArch validates against. The shortened "win"
        # form was rejected and would mismatch curl-builder's
        # win32-prefixed output.
        ifdef TARGET_ARCH
            ifeq ($(TARGET_ARCH),arm64)
                PLATFORM_ARCH := win32-arm64
            else ifeq ($(TARGET_ARCH),aarch64)
                PLATFORM_ARCH := win32-arm64
            else
                PLATFORM_ARCH := win32-x64
            endif
        else
            PLATFORM_ARCH := win32-x64
        endif
    endif
endif

# Check lief-builder's build first, then downloaded location
# Downloaded LIEF extracts flat to {platform-arch}/ (no top-level directory in archive)
LIEF_DOWNLOADED_DIR = $(LIEF_BUILDER_ROOT)/build/downloaded/lief/$(PLATFORM_ARCH)
LIEF_BUILD_DIR = $(LIEF_BUILDER_ROOT)/build/$(BUILD_MODE)/$(PLATFORM_ARCH)/out/Final/lief

# Prefer locally built LIEF (may have patches applied) over downloaded.
ifneq (,$(wildcard $(LIEF_BUILD_DIR)/libLIEF.a))
    LIEF_DIR = $(LIEF_BUILD_DIR)
else ifneq (,$(wildcard $(LIEF_BUILD_DIR)/LIEF.lib))
    LIEF_DIR = $(LIEF_BUILD_DIR)
else ifneq (,$(wildcard $(LIEF_DOWNLOADED_DIR)/libLIEF.a))
    LIEF_DIR = $(LIEF_DOWNLOADED_DIR)
else ifneq (,$(wildcard $(LIEF_DOWNLOADED_DIR)/LIEF.lib))
    LIEF_DIR = $(LIEF_DOWNLOADED_DIR)
else
    LIEF_DIR = $(LIEF_BUILD_DIR)
endif

# MSVC uses LIEF.lib, MinGW/Unix uses libLIEF.a
# We use MinGW on Windows, so always use libLIEF.a
LIEF_LIB = $(LIEF_DIR)/libLIEF.a

# LIEF include flags.
# Use upstream includes if submodule exists (building from source).
# Otherwise use downloaded includes from LIEF_DIR.
ifneq (,$(wildcard $(LIEF_UPSTREAM)/include))
    LIEF_CFLAGS = -I$(LIEF_UPSTREAM)/include -I$(LIEF_DIR)/include
else
    LIEF_CFLAGS = -I$(LIEF_DIR)/include
endif

LIEF_LDFLAGS = $(LIEF_LIB)
LIEF_DEFINES = -DHAVE_LIEF=1
