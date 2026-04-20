# syntax=docker/dockerfile:1.4
#
# Dockerfile for building prepatched ink with bundled yoga-sync.
#
# This Dockerfile:
# 1. Builds yoga-layout-builder to get yoga-sync.mjs
# 2. Downloads ink from npm
# 3. Applies patches
# 4. Bundles yoga-sync.mjs
# 5. Exports the final dist directory
#
# Usage:
#   depot build --file packages/ink-builder/Dockerfile --target export \
#     --build-arg BUILD_MODE=prod --build-arg PLATFORM_ARCH=linux-x64 \
#     --output type=local,dest=packages/ink-builder/build .
#
# BUILD_MODE defaults to 'dev'; CI should pass BUILD_MODE=prod.

# Build arguments
ARG NODE_VERSION=25.9.0
ARG INK_VERSION=6.3.1
# Default BUILD_MODE: 'dev' locally, 'prod' in CI — callers pass --build-arg
# BUILD_MODE=prod in CI to pick up the optimized yoga-sync.
ARG BUILD_MODE=dev
# The Dockerfile always runs Linux; platform-arch mirrors the runner (x64 or arm64).
ARG PLATFORM_ARCH=linux-x64
ARG CACHE_VERSION=v1
# =============================================================================
# Stage 1: Build yoga-layout-builder (to get yoga-sync.mjs)
# =============================================================================
FROM node:${NODE_VERSION}-bookworm AS yoga-builder

ARG BUILD_MODE
ARG PLATFORM_ARCH

# Install build dependencies for yoga (Emscripten, CMake, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    git \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .node-version ./
COPY packages/yoga-layout-builder/package.json packages/yoga-layout-builder/
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

# Copy yoga-layout-builder source
COPY packages/yoga-layout-builder/ packages/yoga-layout-builder/
COPY packages/build-infra/ packages/build-infra/

# Build yoga-layout-builder in the caller-chosen mode (dev locally, prod in CI).
WORKDIR /build/packages/yoga-layout-builder
RUN pnpm run build --${BUILD_MODE}

# =============================================================================
# Stage 2: Build ink with bundled yoga-sync
# =============================================================================
FROM node:${NODE_VERSION}-bookworm AS ink-builder

ARG INK_VERSION
ARG BUILD_MODE
ARG PLATFORM_ARCH
ARG CACHE_VERSION
WORKDIR /build

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .node-version ./
COPY packages/ink-builder/package.json packages/ink-builder/

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

# Copy ink-builder source
COPY packages/ink-builder/ packages/ink-builder/

# Copy yoga-sync.mjs from yoga-builder stage (yoga writes under
# build/<mode>/<platform-arch>/out/Final/; Docker always builds on Linux).
COPY --from=yoga-builder /build/packages/yoga-layout-builder/build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final/yoga-sync.mjs /yoga-sync.mjs

# Build ink
WORKDIR /build/packages/ink-builder

# Create build directory and copy yoga-sync before build. ink-builder's build
# script resolves yoga-sync via getCurrentPlatformArch() so we must place it
# at the per-platform-arch path it expects.
RUN mkdir -p /build/packages/yoga-layout-builder/build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final && \
    cp /yoga-sync.mjs /build/packages/yoga-layout-builder/build/${BUILD_MODE}/${PLATFORM_ARCH}/out/Final/yoga-sync.mjs

RUN pnpm run build

# Create checkpoint
RUN mkdir -p build/checkpoints && \
    echo "INK_VERSION=${INK_VERSION}" > build/checkpoints/ink-built && \
    echo "CACHE_VERSION=${CACHE_VERSION}" >> build/checkpoints/ink-built && \
    date >> build/checkpoints/ink-built

# =============================================================================
# Stage 3: Export artifacts
# =============================================================================
FROM scratch AS export

# Copy dist directory (the final prepatched ink)
COPY --from=ink-builder /build/packages/ink-builder/dist /dist

# Copy checkpoints for cache validation
COPY --from=ink-builder /build/packages/ink-builder/build/checkpoints /checkpoints
