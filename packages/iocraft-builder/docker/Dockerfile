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
ARG CACHE_BUSTER=

# =============================================================================
# Stage 1: Build iocraft native module
# =============================================================================
FROM node:${NODE_VERSION}-bookworm AS builder

ARG BUILD_MODE
ARG RUST_TARGET
ARG PLATFORM_ARCH
ARG CACHE_VERSION
ARG CACHE_BUSTER

WORKDIR /build

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

# Install pnpm
ARG PNPM_VERSION=11.0.0-rc.0
RUN ARCH=$(uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/') && \
    curl -fsSL -o /tmp/pnpm.tar.gz "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linux-${ARCH}.tar.gz" && \
    ACTUAL_SHA256=$(sha256sum /tmp/pnpm.tar.gz | cut -d' ' -f1) && \
    if [ "$ARCH" = "x64" ]; then EXPECTED="fe82b94125a6b743456b869e823611a8837b545f2535e4602578e4c9fdb5742a"; \
    else EXPECTED="69ad2d528f4a2c00fd42541a80c13491c57e66b2765b2d9d89829aeb0f6482be"; fi && \
    if [ "$ACTUAL_SHA256" != "$EXPECTED" ]; then echo "pnpm checksum mismatch!" >&2; exit 1; fi && \
    tar -xzf /tmp/pnpm.tar.gz -C /usr/local/bin && rm /tmp/pnpm.tar.gz

# Install dependencies
RUN pnpm install --frozen-lockfile

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
