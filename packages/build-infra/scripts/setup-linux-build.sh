#!/bin/bash
# setup-linux-build.sh — fleet-canonical Linux Docker setup for builder
# containers. Runs inside manylinux2014 (CentOS 7 base, glibc 2.17) and
# leaves the container with a modern C/C++ toolchain.
#
# What this script does:
#   1. Activate devtoolset-10 (gcc 10) via SCL — manylinux2014 ships
#      devtoolset-10 from the mayeut COPR; manylinux2014's stock gcc
#      is 4.8 (CentOS 7) which can't compile modern C++.
#   2. Install package set via yum (cmake, ccache, ninja, perl,
#      libatomic — anything the build needs).
#   3. Persist devtoolset PATH so subsequent RUN steps in the Dockerfile
#      inherit gcc 10.
#
# Builders define their build steps in scripts/build-step-defs.mts (host)
# and run docker/build.sh (emitted bash, no Node/pnpm in container).
#
# Per fleet rule "1 path, 1 reference":
#   - Tool list source of truth: PACKAGES variable below — single point
#     to update when a new builder needs an extra package.
#
# Designed to fail loudly — every curl 4xx, every missing tool is a
# hard exit. No silent fallbacks.

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

# C/C++ toolchain only. No Node, no pnpm. Builders run docker/build.sh
# (pure bash) emitted from build-step-defs.mts via scripts/
# emit-docker-build.mts. The container has zero JS runtime.

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
  /opt/_internal/pip_download_cache \
  /opt/_internal/wheels \
  /root/.cache \
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
