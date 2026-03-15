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
#   depot build --file packages/ink-builder/Dockerfile --target export --output type=local,dest=packages/ink-builder/build .

# Build arguments
ARG NODE_VERSION=22
ARG INK_VERSION=6.3.1
ARG CACHE_VERSION=v1
ARG CACHE_BUSTER=

# =============================================================================
# Stage 1: Build yoga-layout-builder (to get yoga-sync.mjs)
# =============================================================================
FROM node:${NODE_VERSION}-bookworm AS yoga-builder

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
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy yoga-layout-builder source
COPY packages/yoga-layout-builder/ packages/yoga-layout-builder/
COPY packages/build-infra/ packages/build-infra/

# Build yoga-layout-builder (dev mode for faster builds in CI)
WORKDIR /build/packages/yoga-layout-builder
RUN pnpm run build --dev

# =============================================================================
# Stage 2: Build ink with bundled yoga-sync
# =============================================================================
FROM node:${NODE_VERSION}-bookworm AS ink-builder

ARG INK_VERSION
ARG CACHE_VERSION
ARG CACHE_BUSTER

WORKDIR /build

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .node-version ./
COPY packages/ink-builder/package.json packages/ink-builder/

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy ink-builder source
COPY packages/ink-builder/ packages/ink-builder/

# Copy yoga-sync.mjs from yoga-builder stage
COPY --from=yoga-builder /build/packages/yoga-layout-builder/build/dev/out/Final/yoga-sync.mjs /yoga-sync.mjs

# Build ink
WORKDIR /build/packages/ink-builder

# Create build directory and copy yoga-sync before build
RUN mkdir -p /build/packages/yoga-layout-builder/build/dev/out/Final && \
    cp /yoga-sync.mjs /build/packages/yoga-layout-builder/build/dev/out/Final/yoga-sync.mjs

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
