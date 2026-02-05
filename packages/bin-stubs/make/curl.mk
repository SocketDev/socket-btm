# curl library paths and configuration.
# Provides HTTPS support via libcurl with mbedTLS.
#
# This file is included from stub Makefiles at:
#   packages/bin-stubs/
# Paths are relative from that location.

# Base path to bin-stubs package root from stub Makefile location.
# From: packages/bin-stubs/
# To:   packages/bin-stubs/
BIN_INFRA_ROOT = .

CURL_UPSTREAM = $(BIN_INFRA_ROOT)/upstream/curl
MBEDTLS_UPSTREAM = $(BIN_INFRA_ROOT)/upstream/mbedtls

# curl can come from two locations:
# 1. Downloaded from releases: build/downloaded/curl/{platform-arch}/
# 2. Built from source: build/$(BUILD_MODE)/out/Final/curl/dist/

# Detect platform-arch for downloaded location.
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

# Normalize architecture name to match Node.js arch naming.
# Use TARGET_ARCH if specified (for cross-compilation), otherwise detect from uname.
# TARGET_ARCH values: x86_64, aarch64, arm64
# Node.js arch values: x64, arm64
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
    # Detect from host when not cross-compiling.
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
    # Check for musl.
    CURL_IS_MUSL := $(shell ldd --version 2>&1 | grep -q musl && echo 1 || echo 0)
    ifeq ($(CURL_IS_MUSL),1)
        CURL_PLATFORM_ARCH := linux-$(CURL_ARCH)-musl
    else
        CURL_PLATFORM_ARCH := linux-$(CURL_ARCH)
    endif
else
    # Windows - use win for directory paths to match release asset names.
    # Use TARGET_ARCH if specified for cross-compilation.
    ifdef TARGET_ARCH
        ifeq ($(TARGET_ARCH),aarch64)
            CURL_PLATFORM_ARCH := win-arm64
        else ifeq ($(TARGET_ARCH),arm64)
            CURL_PLATFORM_ARCH := win-arm64
        else
            CURL_PLATFORM_ARCH := win-x64
        endif
    else
        CURL_PLATFORM_ARCH := win-x64
    endif
endif

# Check local build first, then centralized downloaded location.
CURL_DOWNLOADED_DIR = $(BIN_INFRA_ROOT)/build/downloaded/curl/$(CURL_PLATFORM_ARCH)
CURL_BUILD_DIR = $(BIN_INFRA_ROOT)/build/$(BUILD_MODE)/out/Final/curl/dist

# Prefer locally built curl over downloaded.
# Don't check during 'clean' target - only check when actually building.
ifneq ($(MAKECMDGOALS),clean)
    ifneq (,$(wildcard $(CURL_BUILD_DIR)/libcurl.a))
        CURL_DIR = $(CURL_BUILD_DIR)
    else ifneq (,$(wildcard $(CURL_DOWNLOADED_DIR)/libcurl.a))
        CURL_DIR = $(CURL_DOWNLOADED_DIR)
    else
        $(error curl libraries not found. Expected at $(CURL_BUILD_DIR) or $(CURL_DOWNLOADED_DIR). Run build script to download curl dependencies first.)
    endif
else
    # During clean, just set empty CURL_DIR to avoid errors.
    CURL_DIR =
endif

# Only set curl variables if CURL_DIR is not empty.
ifneq ($(CURL_DIR),)
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
else
    # No curl during clean or when not found.
    CURL_CFLAGS =
    CURL_LDFLAGS =
endif
