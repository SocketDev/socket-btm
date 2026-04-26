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
    jq \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .node-version ./
COPY packages/yoga-layout-builder/package.json packages/yoga-layout-builder/
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

# Install jq for registry-tools.json parsing.
RUN apt-get update && apt-get install -y --no-install-recommends jq && \
    rm -rf /var/lib/apt/lists/*

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .node-version ./
COPY packages/ink-builder/package.json packages/ink-builder/
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

# Copy ink-builder and build-infra source (build-infra is a workspace
# dep imported from scripts/build.mts).
COPY packages/ink-builder/ packages/ink-builder/
COPY packages/build-infra/ packages/build-infra/

# Copy yoga-sync.mjs from yoga-builder stage. Path mirrors yoga-layout-builder's
# getBuildPaths() outputSyncMjsFile (see packages/yoga-layout-builder/scripts/paths.mts):
#   build/<mode>/<platform-arch>/wasm/out/Final/yoga-sync.mjs
# Dockerfiles can't import TS, so this string is allowed to duplicate paths.mts —
# it MUST stay byte-for-byte identical.
COPY --from=yoga-builder /build/packages/yoga-layout-builder/build/${BUILD_MODE}/${PLATFORM_ARCH}/wasm/out/Final/yoga-sync.mjs /yoga-sync.mjs

# Build ink
WORKDIR /build/packages/ink-builder

# Place yoga-sync.mjs at the per-platform-arch path that ink-builder's build
# script expects (it imports yoga-layout-builder's getBuildPaths()). The path
# below MUST stay in sync with packages/yoga-layout-builder/scripts/paths.mts.
RUN mkdir -p /build/packages/yoga-layout-builder/build/${BUILD_MODE}/${PLATFORM_ARCH}/wasm/out/Final && \
    cp /yoga-sync.mjs /build/packages/yoga-layout-builder/build/${BUILD_MODE}/${PLATFORM_ARCH}/wasm/out/Final/yoga-sync.mjs

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
