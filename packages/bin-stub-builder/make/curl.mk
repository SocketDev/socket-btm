# curl library paths and configuration.
# Provides HTTPS support via libcurl with mbedTLS.
#
# This file is included from stub Makefiles at:
#   packages/bin-stub-builder/
# Paths are relative from that location.
#
# Path-of-truth (CLAUDE.md "1 path, 1 reference"):
#   - PLATFORM_ARCH env var (e.g. "win32-arm64") is the single source.
#     The set-platform-arch GitHub Action emits it; the JavaScript build
#     scripts pass it through; common.mk reads it for stubs' own
#     `build/<mode>/<PLATFORM_ARCH>/` layout.
#   - We re-use the same PLATFORM_ARCH value verbatim for the
#     curl-builder sibling, since curl-builder's CI also keys its
#     output on the same canonical strings (win32-x64 / win32-arm64 /
#     darwin-arm64 / linux-x64 / linux-x64-musl / etc.).
#   - When PLATFORM_ARCH is unset (local dev outside CI), fall back
#     to a shell-side detector that produces the same string shape.

# curl and mbedTLS upstreams are in the curl-builder sibling package.
CURL_BUILDER_ROOT = ../curl-builder

CURL_UPSTREAM = $(CURL_BUILDER_ROOT)/upstream/curl
MBEDTLS_UPSTREAM = $(CURL_BUILDER_ROOT)/upstream/mbedtls

# curl can come from two locations:
# 1. Downloaded from releases: build/downloaded/curl/{platform-arch}/
# 2. Built from source: build/$(BUILD_MODE)/<platform-arch>/out/Final/curl/dist/

ifdef PLATFORM_ARCH
    # Single source: the env var the workflow already exports for
    # common.mk's BUILD_DIR. No second derivation, no chance of drift.
    CURL_PLATFORM_ARCH := $(PLATFORM_ARCH)
else
    # Local-dev fallback. Detect from `uname` plus optional TARGET_ARCH
    # override for cross-compile. This branch only fires when running
    # `make` directly without the workflow harness; CI always sets
    # PLATFORM_ARCH explicitly.
    UNAME_S := $(shell uname -s)
    UNAME_M := $(shell uname -m)

    ifdef TARGET_ARCH
        ifeq ($(TARGET_ARCH),x86_64)
            CURL_ARCH := x64
        else ifeq ($(TARGET_ARCH),aarch64)
            CURL_ARCH := arm64
        else ifeq ($(TARGET_ARCH),arm64)
            CURL_ARCH := arm64
        else
            CURL_ARCH := $(TARGET_ARCH)
        endif
    else
        ifeq ($(UNAME_M),x86_64)
            CURL_ARCH := x64
        else ifeq ($(UNAME_M),aarch64)
            CURL_ARCH := arm64
        else
            CURL_ARCH := $(UNAME_M)
        endif
    endif

    ifeq ($(UNAME_S),Darwin)
        CURL_PLATFORM_ARCH := darwin-$(CURL_ARCH)
    else ifeq ($(UNAME_S),Linux)
        CURL_IS_MUSL := $(shell ldd --version 2>&1 | grep -q musl && echo 1 || echo 0)
        ifeq ($(CURL_IS_MUSL),1)
            CURL_PLATFORM_ARCH := linux-$(CURL_ARCH)-musl
        else
            CURL_PLATFORM_ARCH := linux-$(CURL_ARCH)
        endif
    else
        # Windows: emit the canonical win32-prefixed form that
        # parsePlatformArch (build-infra/lib/platform-mappings.mts)
        # validates against. The shortened "win" form was rejected by
        # parsePlatformArch and would produce a curl path mismatch
        # against curl-builder's win32-prefixed output.
        CURL_PLATFORM_ARCH := win32-$(CURL_ARCH)
    endif
endif

# Check curl-builder's build first, then downloaded location.
# curl is built by the curl-builder sibling package.
# Downloaded curl extracts flat to {platform-arch}/ (no top-level directory in archive)
CURL_DOWNLOADED_DIR = $(CURL_BUILDER_ROOT)/build/downloaded/curl/$(CURL_PLATFORM_ARCH)
CURL_BUILD_DIR = $(CURL_BUILDER_ROOT)/build/$(BUILD_MODE)/$(CURL_PLATFORM_ARCH)/out/Final/curl/dist

# Prefer locally built curl over downloaded.
ifneq (,$(wildcard $(CURL_BUILD_DIR)/libcurl.a))
    CURL_DIR = $(CURL_BUILD_DIR)
else ifneq (,$(wildcard $(CURL_DOWNLOADED_DIR)/libcurl.a))
    CURL_DIR = $(CURL_DOWNLOADED_DIR)
else
    CURL_DIR = $(CURL_BUILD_DIR)
endif

CURL_LIB = $(CURL_DIR)/libcurl.a
MBEDTLS_LIB = $(CURL_DIR)/libmbedtls.a
MBEDX509_LIB = $(CURL_DIR)/libmbedx509.a
MBEDCRYPTO_LIB = $(CURL_DIR)/libmbedcrypto.a

# curl include flags.
# Use upstream includes if submodule exists (building from source).
# Otherwise use downloaded includes from CURL_DIR.
ifneq (,$(wildcard $(CURL_UPSTREAM)/include))
    CURL_CFLAGS = -I$(CURL_UPSTREAM)/include -I$(CURL_DIR)/include
else
    CURL_CFLAGS = -I$(CURL_DIR)/include
endif

# All libraries needed for curl with mbedTLS.
# Order matters: curl -> mbedtls -> mbedx509 -> mbedcrypto.
CURL_LIBS = $(CURL_LIB) $(MBEDTLS_LIB) $(MBEDX509_LIB) $(MBEDCRYPTO_LIB)

# Windows requires additional system libraries for curl/mbedTLS.
ifeq ($(OS),Windows_NT)
    CURL_LDFLAGS = $(CURL_LIBS) -lbcrypt -lws2_32 -lcrypt32 -ladvapi32
else
    CURL_LDFLAGS = $(CURL_LIBS)
endif
