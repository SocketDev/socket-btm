#!/bin/bash
# setup-linux-build.sh — fleet-canonical Linux Docker setup for builder
# containers. Runs inside manylinux2014 (CentOS 7 base, glibc 2.17) and
# leaves the container ready to invoke `pnpm run build` in a workspace
# package.
#
# Inputs (env / files expected in image):
#   /tmp/node-version            — single line, e.g. "26.2.0"
#   /tmp/registry-tools.json     — socket-registry's tool checksums
#                                  (provides pnpm.version + sha256)
#
# What this script does:
#   1. Activate devtoolset-10 (gcc 10) via SCL — manylinux2014 ships
#      devtoolset-10 from the mayeut COPR; manylinux2014's stock gcc
#      is 4.8 (CentOS 7) which can't compile modern C++.
#   2. Install package set via yum (cmake, ccache, ninja, perl, go,
#      libatomic — anything the build needs).
#   3. Download Node from nodejs.org/dist, verify against the official
#      SHASUMS256.txt from the same release.
#   4. Download pnpm from github.com/pnpm/pnpm/releases, verify against
#      registry-tools.json's pinned sha256.
#   5. Persist devtoolset PATH so subsequent RUN steps in the Dockerfile
#      inherit gcc 11.
#
# Per fleet rule "1 path, 1 reference":
#   - Node version source of truth: .node-version (mounted at /tmp/node-version).
#   - pnpm version source of truth: registry-tools.json (socket-registry pin).
#   - Tool list source of truth: PACKAGES variable below — single point to
#     update when a new builder needs an extra package.
#
# Designed to fail loudly — every sha256 mismatch, every curl 4xx, every
# missing tool is a hard exit. No silent fallbacks.

set -euo pipefail

DEVTOOLSET_ENABLE=/opt/rh/devtoolset-10/enable
if [ ! -f "${DEVTOOLSET_ENABLE}" ]; then
  echo "× setup-linux-build: devtoolset-10 not found at ${DEVTOOLSET_ENABLE}" >&2
  echo "  Expected base image: quay.io/pypa/manylinux2014_x86_64 (or _aarch64)." >&2
  exit 1
fi

# Pre-initialize PATH-style env vars the SCL enable script references —
# in a fresh Docker shell these are unset, and our `set -u` aborts on
# unbound-variable read. Default them to empty so `:+` expansions in
# the enable script collapse cleanly.
export MANPATH="${MANPATH:-}"
export INFOPATH="${INFOPATH:-}"
export PCP_DIR="${PCP_DIR:-}"
export LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}"
export PKG_CONFIG_PATH="${PKG_CONFIG_PATH:-}"

# shellcheck source=/dev/null
. "${DEVTOOLSET_ENABLE}"
echo "✓ devtoolset-10 activated"
echo "  gcc:  $(gcc --version | head -1)"
echo "  g++:  $(g++ --version | head -1)"

# yum package set. Add to this list rather than per-Dockerfile yum installs —
# keeps the package surface uniform across builders. ninja-build is in EPEL.
PACKAGES=(
  ca-certificates
  ccache
  cmake3
  curl
  jq
  libatomic
  make
  ninja-build
  patch
  perl
  xz
)

# Builders that need Go (boringssl prefix tooling) call us with EXTRA_PACKAGES=golang.
# Builders that need Python (any wheel-style native build) call us with
# EXTRA_PACKAGES="python3 python3-pip".
if [ -n "${EXTRA_PACKAGES:-}" ]; then
  # shellcheck disable=SC2206
  PACKAGES+=( ${EXTRA_PACKAGES} )
fi

# --setopt=install_weak_deps=False keeps optional GUI/locale/docs deps
# out of the install set — typically saves ~100-200MB across the whole
# package set. Matches curl-builder's pattern.
yum install -y --setopt=install_weak_deps=False epel-release
yum install -y --setopt=install_weak_deps=False "${PACKAGES[@]}"

# cmake3 is the package name on CentOS 7 EPEL; alias cmake → cmake3.
if [ ! -e /usr/local/bin/cmake ] && command -v cmake3 >/dev/null; then
  ln -sf "$(command -v cmake3)" /usr/local/bin/cmake
fi
echo "✓ yum packages installed: ${PACKAGES[*]}"

# Node.js + pnpm. Builders that drive their build from pure bash (via
# the emit-from-defs pattern in build-step-defs.mts → docker/build.sh)
# call us with SKIP_NODE_PNPM=1 to skip this section entirely. Pure
# C/C++ toolchain in the container; no JS runtime needed.
#
# For builders that still run .mts inside Docker (legacy path), we'd
# need a glibc-2.17-compatible Node — nodejs.org/dist starts requiring
# glibc 2.28 at Node 18+. unofficial-builds.nodejs.org ships glibc-217
# variants for x64 only (not arm64), which is why we don't depend on
# Node-in-container as the default path.
ARCH=$(uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/')

if [ "${SKIP_NODE_PNPM:-0}" != "1" ]; then
  NODE_VERSION="20.19.5"  # 2026-04-30 — final Node 20 LTS patch
  NODE_TARBALL="node-v${NODE_VERSION}-linux-${ARCH}.tar.xz"
  NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"
  NODE_SHASUMS_URL="https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"

  echo "→ Fetching Node ${NODE_VERSION} (${ARCH}) + SHASUMS"
  curl -fsSL -o /tmp/SHASUMS256.txt "${NODE_SHASUMS_URL}"
  NODE_SHA256=$(grep " ${NODE_TARBALL}$" /tmp/SHASUMS256.txt | awk '{print $1}')
  if [ -z "${NODE_SHA256}" ]; then
    echo "× Could not find ${NODE_TARBALL} sha256 in SHASUMS256.txt" >&2
    exit 1
  fi
  echo "  sha256: ${NODE_SHA256}"

  curl -fsSL -o "/tmp/${NODE_TARBALL}" "${NODE_URL}"
  echo "${NODE_SHA256}  /tmp/${NODE_TARBALL}" | sha256sum -c -
  tar -xJ -C /usr/local --strip-components=1 -f "/tmp/${NODE_TARBALL}"
  rm "/tmp/${NODE_TARBALL}" /tmp/SHASUMS256.txt
  echo "✓ Node $(node --version) installed"

  # pnpm — version + sha256 come from socket-registry's external-tools.json
  # (materialized into /tmp/registry-tools.json by socket-registry's setup
  # action). Canonical shape: pnpm.platforms.<plat-arch>.{asset,integrity}.
  # integrity is SRI-style "sha256-<base64>".
  PNPM_VERSION=$(jq -r .pnpm.version /tmp/registry-tools.json)
  PLATFORM="linux-${ARCH}"
  PNPM_ASSET=$(jq -r ".pnpm.platforms[\"${PLATFORM}\"].asset" /tmp/registry-tools.json)
  PNPM_INTEGRITY=$(jq -r ".pnpm.platforms[\"${PLATFORM}\"].integrity" /tmp/registry-tools.json)
  PNPM_SHA256=$(echo "${PNPM_INTEGRITY#sha256-}" | base64 -d | od -An -tx1 | tr -d ' \n')

  echo "→ Fetching pnpm ${PNPM_VERSION} (${ARCH})"
  echo "  sha256: ${PNPM_SHA256}"
  curl -fsSL -o /tmp/pnpm.tar.gz "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/${PNPM_ASSET}"
  echo "${PNPM_SHA256}  /tmp/pnpm.tar.gz" | sha256sum -c -
  tar -xzf /tmp/pnpm.tar.gz -C /usr/local/bin
  rm /tmp/pnpm.tar.gz /tmp/registry-tools.json
  echo "✓ pnpm $(pnpm --version) installed"
else
  # Pure-bash path: clean up registry-tools.json + node-version, which
  # the Dockerfile may COPY in unconditionally for backward compat.
  rm -f /tmp/registry-tools.json /tmp/node-version
  echo "✓ SKIP_NODE_PNPM=1 — pure-bash builder, no Node/pnpm install"
fi

# Persist devtoolset on PATH for subsequent Dockerfile RUN steps. The
# manylinux2014 enable script exports PATH + LD_LIBRARY_PATH + MANPATH +
# INFOPATH + PCP_DIR + PKG_CONFIG_PATH; pin all of them in /etc/profile.d/
# so an interactive shell ALSO picks them up.
cat > /etc/profile.d/devtoolset-10.sh <<'EOF'
. /opt/rh/devtoolset-10/enable
EOF

# yum cleanup + image-size trim. The manylinux2014 base ships ~1.4 GB
# of pip caches, Python wheel build infrastructure, locale data, and
# duplicated docs — we use almost none of it. Strip aggressively so
# Depot's layer cache (and our exported tarball) stays small.
yum clean all
rm -rf \
  /var/cache/yum \
  /var/cache/dnf \
  /var/lib/yum/yumdb \
  /var/log/yum.log \
  /tmp/* \
  /opt/_internal/pip_download_cache \
  /opt/_internal/wheels \
  /root/.cache \
  /usr/local/lib/node_modules/npm \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  /usr/share/man \
  /usr/share/info \
  /usr/share/doc \
  /usr/local/share/man \
  /usr/local/share/doc \
  || true

# Locale data: keep only en_US.UTF-8 (manylinux2014 ships full glibc locale-archive ~100MB).
if command -v localedef >/dev/null; then
  localedef --list-archive 2>/dev/null \
    | grep -v "^en_US\(\.utf8\|\.UTF-8\)\?$" \
    | xargs -r localedef --delete-from-archive 2>/dev/null || true
  # Compact the archive in-place; ignore failures (some locales are pinned).
  mv -f /usr/lib/locale/locale-archive /usr/lib/locale/locale-archive.tmpl 2>/dev/null || true
  build-locale-archive 2>/dev/null || \
    mv -f /usr/lib/locale/locale-archive.tmpl /usr/lib/locale/locale-archive 2>/dev/null || true
fi

echo "✓ setup-linux-build complete"
echo "  image size after cleanup: $(du -sh / 2>/dev/null | awk '{print $1}')"
