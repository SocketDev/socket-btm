#!/bin/bash
# Temporary build script until Makefile issues resolved

set -e

cd "$(dirname "$0")/.."

BUILD_DIR="build/dev"
OUT_DIR="$BUILD_DIR/out"
LIEF_LIB="$BUILD_DIR/lief/libLIEF.a"

mkdir -p "$BUILD_DIR" "$OUT_DIR"

echo "Building binpress..."

# Compile C files
/usr/bin/clang -Wall -Wextra -O0 -g -std=c11 \
    -I../bin-infra/src \
    -DVERSION=\"dev\" \
    -D_POSIX_C_SOURCE=200809L \
    -D_XOPEN_SOURCE=700 \
    -DHAVE_LIEF=1 \
    -c src/macho_compress.c -o "$BUILD_DIR/macho_compress.o"

/usr/bin/clang -Wall -Wextra -O0 -g -std=c11 \
    -I../bin-infra/src \
    -c ../bin-infra/src/compression_common.c -o "$BUILD_DIR/compression_common.o"

/usr/bin/clang -Wall -Wextra -O0 -g -std=c11 \
    -I../bin-infra/src \
    -c ../bin-infra/src/file_io_common.c -o "$BUILD_DIR/file_io_common.o"

# Compile C++ files
/usr/bin/clang++ -Wall -Wextra -O0 -g -std=c++17 \
    -I../bin-infra/src \
    -Iupstream/lief/include \
    -I$BUILD_DIR/lief/include \
    -DHAVE_LIEF=1 \
    -c src/macho_compress_segment.cpp -o "$BUILD_DIR/macho_compress_segment.o"

# Link
/usr/bin/clang++ -O0 -g -o "$OUT_DIR/binpress" \
    "$BUILD_DIR/macho_compress.o" \
    "$BUILD_DIR/compression_common.o" \
    "$BUILD_DIR/file_io_common.o" \
    "$BUILD_DIR/macho_compress_segment.o" \
    "$LIEF_LIB" \
    -lcompression -Wl,-dead_strip

# Sign
codesign -s - "$OUT_DIR/binpress" 2>/dev/null || true

echo "Built: $OUT_DIR/binpress"
"$OUT_DIR/binpress" --version
