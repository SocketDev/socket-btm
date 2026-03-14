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
#   depot build --file packages/iocraft-builder/Dockerfile --target export --output type=local,dest=packages/iocraft-builder/build .

# Build arguments
ARG NODE_VERSION=22
ARG BUILD_MODE=prod
ARG RUST_TARGET=x86_64-unknown-linux-gnu
ARG CACHE_VERSION=v1
ARG CACHE_BUSTER=

# =============================================================================
# Stage 1: Build iocraft native module
# =============================================================================
FROM node:${NODE_VERSION}-bookworm AS builder

ARG BUILD_MODE
ARG RUST_TARGET
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
COPY packages/lib/package.json packages/lib/
COPY packages/build-infra/package.json packages/build-infra/

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy iocraft-builder source
COPY packages/iocraft-builder/ packages/iocraft-builder/
COPY packages/lib/ packages/lib/
COPY packages/build-infra/ packages/build-infra/

# Build iocraft native module
WORKDIR /build/packages/iocraft-builder

# Build with cargo
RUN if [ "$BUILD_MODE" = "prod" ]; then \
      cargo build --release --target ${RUST_TARGET}; \
      ARTIFACT_DIR="target/${RUST_TARGET}/release"; \
    else \
      cargo build --target ${RUST_TARGET}; \
      ARTIFACT_DIR="target/${RUST_TARGET}/debug"; \
    fi && \
    mkdir -p build/${BUILD_MODE}/out/Final && \
    cp ${ARTIFACT_DIR}/libiocraft_node.so build/${BUILD_MODE}/out/Final/iocraft.node

# Create checkpoint
RUN mkdir -p build/${BUILD_MODE}/checkpoints && \
    echo "BUILD_MODE=${BUILD_MODE}" > build/${BUILD_MODE}/checkpoints/native-built && \
    echo "RUST_TARGET=${RUST_TARGET}" >> build/${BUILD_MODE}/checkpoints/native-built && \
    echo "CACHE_VERSION=${CACHE_VERSION}" >> build/${BUILD_MODE}/checkpoints/native-built && \
    date >> build/${BUILD_MODE}/checkpoints/native-built

# =============================================================================
# Stage 2: Export artifacts
# =============================================================================
FROM scratch AS export

ARG BUILD_MODE

# Copy native module
COPY --from=builder /build/packages/iocraft-builder/build/${BUILD_MODE}/out/Final/iocraft.node /out/Final/iocraft.node

# Copy checkpoints for cache validation
COPY --from=builder /build/packages/iocraft-builder/build/${BUILD_MODE}/checkpoints /checkpoints
