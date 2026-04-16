# libdeflate library paths and configuration.
# Used for high-performance gzip compression on Linux and Windows.
# macOS uses the built-in Compression framework instead.

# Path relative to binject package directory
LIBDEFLATE_UPSTREAM = upstream/libdeflate
LIBDEFLATE_BUILD_DIR = $(LIBDEFLATE_UPSTREAM)/build
LIBDEFLATE_LIB = $(LIBDEFLATE_BUILD_DIR)/libdeflate.a
LIBDEFLATE_INCLUDE_DIR = $(LIBDEFLATE_UPSTREAM)

# libdeflate include flags.
LIBDEFLATE_CFLAGS = -I$(LIBDEFLATE_INCLUDE_DIR)

# libdeflate linker flags.
LIBDEFLATE_LDFLAGS = $(LIBDEFLATE_LIB)

# Build libdeflate library if not already built.
# Use CMake to build a static library.
# Clear CFLAGS/LDFLAGS to prevent CMake from inheriting paths to libraries not yet built.
# On Windows, force MinGW Makefiles generator since we build with MinGW gcc.
ifeq ($(OS),Windows_NT)
    CMAKE_GENERATOR = -G "MinGW Makefiles"
    # For Windows ARM64 cross-compilation, set CMake toolchain variables.
    ifneq (,$(filter arm64 aarch64,$(TARGET_ARCH)))
        CMAKE_CROSS_COMPILE = -DCMAKE_SYSTEM_NAME=Windows \
            -DCMAKE_SYSTEM_PROCESSOR=aarch64 \
            -DCMAKE_C_COMPILER=aarch64-w64-mingw32-gcc
    else
        CMAKE_CROSS_COMPILE =
    endif
else
    CMAKE_GENERATOR =
    CMAKE_CROSS_COMPILE =
endif

$(LIBDEFLATE_LIB): | $(LIBDEFLATE_BUILD_DIR)
	@echo "Building libdeflate library..."
	@cd $(LIBDEFLATE_BUILD_DIR) && CFLAGS="" CXXFLAGS="" LDFLAGS="" cmake .. \
		$(CMAKE_GENERATOR) \
		$(CMAKE_CROSS_COMPILE) \
		-DCMAKE_BUILD_TYPE=Release \
		-DLIBDEFLATE_BUILD_STATIC_LIB=ON \
		-DLIBDEFLATE_BUILD_SHARED_LIB=OFF \
		-DLIBDEFLATE_BUILD_GZIP=OFF \
		-DCMAKE_POSITION_INDEPENDENT_CODE=ON
	@CFLAGS="" CXXFLAGS="" LDFLAGS="" $(MAKE) -C $(LIBDEFLATE_BUILD_DIR) --no-print-directory
	@echo "Built: $(LIBDEFLATE_LIB)"

$(LIBDEFLATE_BUILD_DIR):
	@mkdir -p $(LIBDEFLATE_BUILD_DIR)
