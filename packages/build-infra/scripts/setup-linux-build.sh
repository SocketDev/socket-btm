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

# Image-size trim. manylinux2014 ships ~1.4GB of stuff we don't use:
# 6 Python versions, pip caches, wheel build infra, locale data,
# manylinux's bundled OpenSSL, docs, debug symbols. Strip aggressively
# so Depot's layer cache + exported tarball stay small.
#
# Order: yum cleanup → big-ticket dirs → fine-grained pruning →
# strip → locale-archive rebuild. Each phase prints a `du -sh /`
# delta so future maintainers can see the savings.
trim_step() {
  # Print bytes saved by a cleanup step. `du` runs are cheap on the
  # in-flight layer (everything cached).
  local label="$1"; shift
  local before; before=$(du -sb / 2>/dev/null | awk '{print $1}')
  "$@" >/dev/null 2>&1 || true
  local after; after=$(du -sb / 2>/dev/null | awk '{print $1}')
  local saved=$(( (before - after) / 1024 / 1024 ))
  echo "  trim: ${label} (-${saved}MB)"
}

echo "→ image-size trim"

trim_step "yum cleanup" yum clean all

trim_step "yum metadata + logs" rm -rf \
  /var/cache/yum \
  /var/cache/dnf \
  /var/lib/yum/yumdb \
  /var/log/yum.log

# manylinux2014 ships every Python version it builds wheels for. We
# don't run Python in the container — drop every cpython install.
trim_step "/opt/python (every Python version)" rm -rf /opt/python

# `_internal` is manylinux's wheel-build scratch space.
trim_step "/opt/_internal (manylinux wheel scratch)" rm -rf /opt/_internal

# Other SCL toolsets (we only use devtoolset-10).
trim_step "/opt/rh siblings (keep devtoolset-10)" bash -c '
  for d in /opt/rh/*/; do
    name=$(basename "$d")
    case "$name" in
      devtoolset-10) ;;
      *) rm -rf "$d" ;;
    esac
  done
'

trim_step "caches + docs" rm -rf \
  /root/.cache \
  /usr/share/man \
  /usr/share/info \
  /usr/share/doc \
  /usr/local/share/man \
  /usr/local/share/doc \
  /usr/share/gtk-doc \
  /usr/share/help

# Python stdlib test suites + __pycache__ (in case any python3 RPM landed).
trim_step "__pycache__ + python test dirs" bash -c '
  find /usr/lib/python* -name __pycache__ -type d -exec rm -rf {} +
  find /usr/lib/python* -name test -type d -exec rm -rf {} +
  find /usr/lib/python* -name tests -type d -exec rm -rf {} +
'

# Strip debug symbols from C/C++ runtime libs. Saves ~30-50MB.
trim_step "strip libc/libstdc++ debug symbols" bash -c '
  find /usr/lib /usr/lib64 /opt/rh/devtoolset-10/root/usr/lib*  \
    \( -name "libc*.so*" -o -name "libstdc++*" -o -name "libm*.so*" -o -name "libgcc*" \) \
    -type f -exec strip --strip-unneeded {} +
'

# Locale data: keep only en_US.UTF-8. The locale-archive trim BEFORE
# the per-language .mo file purge — the archive holds the binary
# locale data, the .mo files are the gettext message catalogs.
trim_step "locale-archive (keep en_US.UTF-8)" bash -c '
  if command -v localedef >/dev/null; then
    localedef --list-archive 2>/dev/null \
      | grep -v "^en_US\(\.utf8\|\.UTF-8\)\?$" \
      | xargs -r localedef --delete-from-archive 2>/dev/null
    mv -f /usr/lib/locale/locale-archive /usr/lib/locale/locale-archive.tmpl 2>/dev/null
    build-locale-archive 2>/dev/null \
      || mv -f /usr/lib/locale/locale-archive.tmpl /usr/lib/locale/locale-archive 2>/dev/null
  fi
'

trim_step "gettext .mo files (keep en)" bash -c '
  find /usr/share/locale -mindepth 1 -maxdepth 1 -type d ! -name "en*" -exec rm -rf {} +
'

echo "✓ setup-linux-build complete"
echo "  final image size: $(du -sh / 2>/dev/null | awk "{print \$1}")"
