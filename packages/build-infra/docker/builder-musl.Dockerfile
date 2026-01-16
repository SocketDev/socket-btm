# Unified musl builder image for Socket BTM
#
# This is a general-purpose build image containing all tools needed to build
# any package in the monorepo. It uses Alpine 3.19 with musl libc for
# static linking and minimal binary size.
#
# Supports: linux/amd64, linux/arm64
#
# Usage:
#   docker build -f builder-musl.Dockerfile -t socket-btm/builder-musl:x64 --platform linux/amd64 .
#   docker run -v $(pwd):/workspace socket-btm/builder-musl:x64 pnpm run build

ARG TARGETPLATFORM
ARG BUILDPLATFORM

FROM alpine:3.19

# Build arguments for cache invalidation
ARG CACHE_VERSION=v1

# Install build dependencies
RUN echo "Builder image cache version: ${CACHE_VERSION}" && \
    apk add --no-cache \
        # Core build tools
        g++ \
        make \
        ninja \
        git \
        patch \
        ccache \
        # Static linking support
        musl-dev \
        openssl-dev \
        openssl-libs-static \
        # Development tools
        pkgconf \
        binutils \
        # Runtime dependencies
        curl \
        ca-certificates \
        bash \
        # Node.js and Python
        nodejs \
        npm \
        python3 \
        py3-pip \
        && \
    # Install cmake via pip (Alpine's cmake may be outdated)
    pip3 install --no-cache-dir --break-system-packages cmake>=3.24 && \
    # Create pkg-config symlink
    ln -sf /usr/bin/pkgconf /usr/bin/pkg-config && \
    # Install pnpm globally
    npm install -g pnpm@10.26.1

# Build xz/liblzma from source with static library (pinned version with SHA256)
# Version/SHA defined in docker-compose.yml for single source of truth
ARG XZ_VERSION
ARG XZ_SHA256
RUN cd /tmp && \
    curl -fsSL "https://github.com/tukaani-project/xz/releases/download/v${XZ_VERSION}/xz-${XZ_VERSION}.tar.gz" -o xz.tar.gz && \
    echo "${XZ_SHA256}  xz.tar.gz" | sha256sum -c - && \
    tar xzf xz.tar.gz && \
    cd "xz-${XZ_VERSION}" && \
    ./configure --enable-static --disable-shared --prefix=/usr && \
    make -j$(nproc) && \
    make install && \
    cd / && rm -rf /tmp/xz*

# Set up ccache
ENV PATH="/usr/lib/ccache:${PATH}"
ENV CCACHE_DIR="/workspace/.ccache"

# Default working directory
WORKDIR /workspace

# Environment for builds
ENV CI=true
ENV BUILD_MODE=prod

# Verify installation
RUN echo "=== Builder Image Info ===" && \
    echo "Platform: $(uname -m)" && \
    echo "musl: $(ldd 2>&1 | head -1 || echo 'musl libc')" && \
    echo "GCC: $(gcc --version | head -1)" && \
    echo "CMake: $(cmake --version | head -1)" && \
    echo "Node: $(node --version)" && \
    echo "pnpm: $(pnpm --version)" && \
    echo "=========================="

# Default command (can be overridden)
CMD ["bash"]
