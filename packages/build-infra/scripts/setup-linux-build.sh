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
#   1. Activate devtoolset-11 (gcc 11) via SCL — manylinux2014's stock
#      gcc is 4.8 (CentOS 7) which can't compile modern C++.
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

DEVTOOLSET_ENABLE=/opt/rh/devtoolset-11/enable
if [ ! -f "${DEVTOOLSET_ENABLE}" ]; then
  echo "× setup-linux-build: devtoolset-11 not found at ${DEVTOOLSET_ENABLE}" >&2
  echo "  Expected base image: quay.io/pypa/manylinux2014_x86_64 (or _aarch64)." >&2
  exit 1
fi

# shellcheck source=/dev/null
. "${DEVTOOLSET_ENABLE}"
echo "✓ devtoolset-11 activated"
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

yum install -y epel-release
yum install -y "${PACKAGES[@]}"

# cmake3 is the package name on CentOS 7 EPEL; alias cmake → cmake3.
if [ ! -e /usr/local/bin/cmake ] && command -v cmake3 >/dev/null; then
  ln -sf "$(command -v cmake3)" /usr/local/bin/cmake
fi
echo "✓ yum packages installed: ${PACKAGES[*]}"

# Node.js — fetch from nodejs.org/dist, verify against same release's
# SHASUMS256.txt. nodejs.org signs the SHASUMS file separately; we trust
# TLS to deliver it from nodejs.org but pin the tarball sha against the
# SHASUMS line for THIS specific release.
NODE_VERSION="$(tr -d '[:space:]' < /tmp/node-version)"
ARCH=$(uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/')
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

# pnpm — version + sha256 come from socket-registry's tool checksums.
PNPM_VERSION=$(jq -r .pnpm.version /tmp/registry-tools.json)
PLATFORM="linux-${ARCH}"
PNPM_ASSET=$(jq -r ".pnpm.checksums[\"${PLATFORM}\"].asset" /tmp/registry-tools.json)
PNPM_INTEGRITY=$(jq -r ".pnpm.checksums[\"${PLATFORM}\"].integrity" /tmp/registry-tools.json)
PNPM_SHA256=$(echo "${PNPM_INTEGRITY#sha256-}" | base64 -d | od -An -tx1 | tr -d ' \n')

echo "→ Fetching pnpm ${PNPM_VERSION} (${ARCH})"
echo "  sha256: ${PNPM_SHA256}"
curl -fsSL -o /tmp/pnpm.tar.gz "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/${PNPM_ASSET}"
echo "${PNPM_SHA256}  /tmp/pnpm.tar.gz" | sha256sum -c -
tar -xzf /tmp/pnpm.tar.gz -C /usr/local/bin
rm /tmp/pnpm.tar.gz /tmp/registry-tools.json /tmp/node-version
echo "✓ pnpm $(pnpm --version) installed"

# Persist devtoolset on PATH for subsequent Dockerfile RUN steps. The
# manylinux2014 enable script exports PATH + LD_LIBRARY_PATH + MANPATH +
# INFOPATH + PCP_DIR + PKG_CONFIG_PATH; pin all of them in /etc/profile.d/
# so an interactive shell ALSO picks them up.
cat > /etc/profile.d/devtoolset-11.sh <<'EOF'
. /opt/rh/devtoolset-11/enable
EOF

# yum cleanup keeps the resulting image small.
yum clean all
rm -rf /var/cache/yum
echo "✓ setup-linux-build complete"
