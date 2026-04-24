# syntax=docker/dockerfile:1.4
#
# Dockerfile for building iocraft native Node.js module via napi-rs.
#
# NOTE: This Dockerfile is for Linux builds only (glibc).
# macOS and Windows builds run natively on GitHub Actions runners
# as they require platform-specific toolchains.
#
# This Dockerfile:
# 1. Sets up Rust toolchain with target architecture
# 2. Builds iocraft native module via cargo/napi-rs
# 3. Exports the final .node file
#
# Usage:
#   depot build --file packages/iocraft-builder/Dockerfile --target export \
#     --build-arg PLATFORM_ARCH=linux-x64 --build-arg RUST_TARGET=x86_64-unknown-linux-gnu \
#     --output type=local,dest=packages/iocraft-builder/build .

# Build arguments
ARG NODE_VERSION=25.9.0
ARG BUILD_MODE=prod
ARG RUST_TARGET=x86_64-unknown-linux-gnu
ARG PLATFORM_ARCH=linux-x64
ARG CACHE_VERSION=v1
# =============================================================================
# Stage 1: Build iocraft native module
# =============================================================================
FROM node:${NODE_VERSION}-bookworm AS builder

ARG BUILD_MODE
ARG RUST_TARGET
ARG PLATFORM_ARCH
ARG CACHE_VERSION
WORKDIR /build

# Install jq for registry-tools.json parsing.
RUN apt-get update && apt-get install -y --no-install-recommends jq && \
    rm -rf /var/lib/apt/lists/*

# Install Rust toolchain
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"

# Add Rust target
RUN rustup target add ${RUST_TARGET}

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .node-version ./
COPY packages/iocraft-builder/package.json packages/iocraft-builder/
COPY packages/iocraft-builder/Cargo.toml packages/iocraft-builder/
COPY packages/build-infra/package.json packages/build-infra/

# Socket-registry tool-checksums. Workflows `cp "$SOCKET_TOOL_CHECKSUMS_FILE"
# .build-context/registry-tools.json` before `docker build`, so this
# layer reads the same authoritative pnpm version + per-platform sha256
# that the setup action verified on the runner — no hardcoded SHA
# blocks in this Dockerfile. The file is gitignored; it materializes
# fresh for every CI run from socket-registry's pinned SHA.
COPY .build-context/registry-tools.json /tmp/registry-tools.json

# Install pnpm
RUN ARCH=$(uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/') && \
    PLATFORM="linux-${ARCH}" && \
    PNPM_VERSION=$(jq -r .pnpm.version /tmp/registry-tools.json) && \
    PNPM_ASSET=$(jq -r ".pnpm.checksums[\"${PLATFORM}\"].asset" /tmp/registry-tools.json) && \
    PNPM_SHA256=$(jq -r ".pnpm.checksums[\"${PLATFORM}\"].sha256" /tmp/registry-tools.json) && \
    curl -fsSL -o /tmp/pnpm.tar.gz "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/${PNPM_ASSET}" && \
    echo "${PNPM_SHA256}  /tmp/pnpm.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/pnpm.tar.gz -C /usr/local/bin && \
    rm /tmp/pnpm.tar.gz /tmp/registry-tools.json

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy iocraft-builder source
COPY packages/iocraft-builder/ packages/iocraft-builder/
COPY packages/build-infra/ packages/build-infra/

# Build iocraft native module
WORKDIR /build/packages/iocraft-builder

# Build with cargo. Output layout matches iocraft-builder/scripts/paths.mts:
#   build/<mode>/<platform-arch>/out/<platform-arch>/iocraft.node  (primary)
#   build/<mode>/<platform-arch>/out/Final/iocraft.node            (copy for artifact upload)
RUN if [ "$BUILD_MODE" = "prod" ]; then \
      cargo build --release --target ${RUST_TARGET}; \
      ARTIFACT_DIR="target/${RUST_TARGET}/release"; \
    else \
      cargo build --target ${RUST_TARGET}; \
      ARTIFACT_DIR="target/${RUST_TARGET}/debug"; \
    fi && \
    mkdir -p build/${BUILD_MODE}/${PLATFORM_ARCH}/out/${PLATFORM_ARCH} \
             build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final && \
    cp ${ARTIFACT_DIR}/libiocraft_node.so \
       build/${BUILD_MODE}/${PLATFORM_ARCH}/out/${PLATFORM_ARCH}/iocraft.node && \
    cp ${ARTIFACT_DIR}/libiocraft_node.so \
       build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final/iocraft.node

# Create checkpoint
RUN mkdir -p build/${BUILD_MODE}/${PLATFORM_ARCH}/checkpoints && \
    echo "BUILD_MODE=${BUILD_MODE}" > build/${BUILD_MODE}/${PLATFORM_ARCH}/checkpoints/native-built && \
    echo "RUST_TARGET=${RUST_TARGET}" >> build/${BUILD_MODE}/${PLATFORM_ARCH}/checkpoints/native-built && \
    echo "CACHE_VERSION=${CACHE_VERSION}" >> build/${BUILD_MODE}/${PLATFORM_ARCH}/checkpoints/native-built && \
    date >> build/${BUILD_MODE}/${PLATFORM_ARCH}/checkpoints/native-built

# =============================================================================
# Stage 2: Export artifacts
# =============================================================================
FROM scratch AS export

ARG BUILD_MODE
ARG PLATFORM_ARCH

# Copy native module
COPY --from=builder /build/packages/iocraft-builder/build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final/iocraft.node /out/Final/iocraft.node

# Copy checkpoints for cache validation
COPY --from=builder /build/packages/iocraft-builder/build/${BUILD_MODE}/${PLATFORM_ARCH}/checkpoints /checkpoints
