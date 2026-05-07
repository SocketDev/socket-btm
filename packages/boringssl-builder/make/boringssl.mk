# BoringSSL library paths and configuration.
# BoringSSL is built by this package (boringssl-builder) with
# -DBORINGSSL_PREFIX=smol, so every public symbol becomes smol_*.
#
# Path-of-truth (CLAUDE.md "1 path, 1 reference"):
#   - PLATFORM_ARCH env var (e.g. "win32-arm64") is the single source.
#     The set-platform-arch GitHub Action emits it; the JavaScript build
#     scripts pass it through; common.mk reads it for the
#     `build/<mode>/<PLATFORM_ARCH>/` layout that ALL packages share.
#   - boringssl-builder ITSELF and every consumer that `include`s this
#     file see the same value via the same env var.
#   - When PLATFORM_ARCH is unset (local dev outside CI), fall back to a
#     shell-side detector that produces the same string shape (canonical
#     fleet form, validated by parsePlatformArch in
#     build-infra/lib/platform-mappings.mts: darwin-{x64,arm64} /
#     linux-{x64,arm64}[-musl] / win32-{x64,arm64}).

# Path to boringssl-builder package root (relative to package Makefiles
# that include this file). All packages that include this are in
# packages/*/ so boringssl-builder is always at ../boringssl-builder.
BORINGSSL_BUILDER_ROOT = ../boringssl-builder

BORINGSSL_UPSTREAM = $(BORINGSSL_BUILDER_ROOT)/upstream/boringssl

# BoringSSL can come from two locations:
# 1. Downloaded from releases: boringssl-builder/build/downloaded/boringssl/{platform-arch}/
# 2. Built from source: boringssl-builder/build/$(BUILD_MODE)/<platform-arch>/out/Final/

ifndef PLATFORM_ARCH
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

# Check boringssl-builder's build first, then downloaded location.
# Downloaded BoringSSL extracts flat to {platform-arch}/ (no top-level
# directory in archive).
BORINGSSL_DOWNLOADED_DIR = $(BORINGSSL_BUILDER_ROOT)/build/downloaded/boringssl/$(PLATFORM_ARCH)
BORINGSSL_BUILD_DIR = $(BORINGSSL_BUILDER_ROOT)/build/$(BUILD_MODE)/$(PLATFORM_ARCH)/out/Final

# Prefer locally built BoringSSL (may have patches applied) over downloaded.
ifneq (,$(wildcard $(BORINGSSL_BUILD_DIR)/lib/libsmol_crypto.a))
    BORINGSSL_DIR = $(BORINGSSL_BUILD_DIR)
else ifneq (,$(wildcard $(BORINGSSL_BUILD_DIR)/lib/smol_crypto.lib))
    BORINGSSL_DIR = $(BORINGSSL_BUILD_DIR)
else ifneq (,$(wildcard $(BORINGSSL_DOWNLOADED_DIR)/lib/libsmol_crypto.a))
    BORINGSSL_DIR = $(BORINGSSL_DOWNLOADED_DIR)
else ifneq (,$(wildcard $(BORINGSSL_DOWNLOADED_DIR)/lib/smol_crypto.lib))
    BORINGSSL_DIR = $(BORINGSSL_DOWNLOADED_DIR)
else
    BORINGSSL_DIR = $(BORINGSSL_BUILD_DIR)
endif

# MSVC uses smol_*.lib, MinGW/Unix uses libsmol_*.a. We use MinGW on
# Windows, so always use the .a form.
BORINGSSL_CRYPTO_LIB = $(BORINGSSL_DIR)/lib/libsmol_crypto.a
BORINGSSL_SSL_LIB = $(BORINGSSL_DIR)/lib/libsmol_ssl.a

# BoringSSL include flags. The prefixed `openssl/` headers are emitted
# under $(BORINGSSL_DIR)/include/openssl/; consumers include them as
# `#include <openssl/ssl.h>` and the symbol prefix happens via macros
# in the headers themselves.
BORINGSSL_CFLAGS = -I$(BORINGSSL_DIR)/include

BORINGSSL_LDFLAGS = $(BORINGSSL_SSL_LIB) $(BORINGSSL_CRYPTO_LIB)
BORINGSSL_DEFINES = -DBORINGSSL_PREFIX=smol
