#!/bin/sh
set -e

# Ensure vendored zstd source is available (submodule may not be in Docker context).

if [ -f packages/bin-infra/upstream/zstd/lib/zstd.h ]; then
    exit 0
fi

ZSTD_VERSION=$(grep -B1 'submodule "packages/bin-infra/upstream/zstd"' .gitmodules | head -1 | sed 's/^# zstd-//')
rm -rf packages/bin-infra/upstream/zstd
curl -fsSL "https://github.com/facebook/zstd/archive/refs/tags/v${ZSTD_VERSION}.tar.gz" | \
    tar xz -C packages/bin-infra/upstream/
mv "packages/bin-infra/upstream/zstd-${ZSTD_VERSION}" packages/bin-infra/upstream/zstd
