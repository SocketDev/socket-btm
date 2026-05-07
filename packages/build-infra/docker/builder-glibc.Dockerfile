# Unified glibc builder image for Socket BTM
#
# This is a general-purpose build image containing all tools needed to build
# any package in the monorepo. It uses AlmaLinux 8 (glibc 2.28) for maximum
# compatibility with older Linux distributions.
#
# Supports: linux/amd64, linux/arm64
#
# Usage:
#   docker build -f builder-glibc.Dockerfile -t socket-btm/builder-glibc:x64 --platform linux/amd64 .
#   docker run -v $(pwd):/workspace socket-btm/builder-glibc:x64 pnpm run build

ARG TARGETPLATFORM
ARG BUILDPLATFORM

FROM almalinux:8

# Build arguments for cache invalidation and version pinning
# Values defined in docker-compose.yml for single source of truth
ARG CACHE_VERSION
ARG GCC_TOOLSET

# Install build dependencies
# AlmaLinux 8 has glibc 2.28, which provides maximum compatibility
# Enable PowerTools for ninja-build, glibc-static
# Enable EPEL for ccache
RUN echo "Builder image cache version: ${CACHE_VERSION}" && \
    dnf -y update && \
    dnf -y install epel-release dnf-plugins-core && \
    dnf config-manager --set-enabled powertools && \
    dnf -y install \
        # GCC Toolset 13 for C++20 support (Node.js v24+ requires GCC 12.2+)
        gcc-toolset-13-gcc-c++ \
        gcc-toolset-13-libstdc++-devel \
        # Core build tools
        make \
        cmake \
        ninja-build \
        git \
        patch \
        ccache \
        # Static linking support
        glibc-static \
        # Development libraries
        openssl-devel \
        pkgconfig \
        binutils \
        # Runtime dependencies
        curl \
        ca-certificates \
        # Python for build scripts
        python3.11 \
        python3.11-pip \
        && \
    # Install Node.js LTS from NodeSource
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash - && \
    dnf -y install nodejs && \
    # Install pnpm globally
    npm install -g pnpm@10.26.1 && \
    # Cleanup to reduce image size
    dnf clean all && \
    rm -rf /var/cache/dnf

# Enable GCC Toolset by default (adds to PATH and sets CC/CXX)
# Version defined in docker-compose.yml for single source of truth
ARG GCC_TOOLSET
ARG GCC_TOOLSET_PATH
ENV PATH="${GCC_TOOLSET_PATH}:${PATH}"
ENV CC=gcc
ENV CXX=g++

# Set up ccache
ENV PATH="/usr/lib64/ccache:${PATH}"
ENV CCACHE_DIR="/workspace/.ccache"

# Default working directory
WORKDIR /workspace

# Environment for builds
ENV CI=true
ENV BUILD_MODE=prod

# Verify installation
RUN echo "=== Builder Image Info ===" && \
    echo "Platform: $(uname -m)" && \
    echo "glibc: $(ldd --version | head -1)" && \
    echo "GCC: $(gcc --version | head -1)" && \
    echo "CMake: $(cmake --version | head -1)" && \
    echo "Node: $(node --version)" && \
    echo "pnpm: $(pnpm --version)" && \
    echo "=========================="

# Default command (can be overridden)
CMD ["bash"]
