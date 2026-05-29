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
  echo "× setup-linux-build: devtoolset-10 not found at ${DEVTOOLSET_ENABLE} — expected manylinux2014 base" >&2
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
echo "✓ devtoolset-10 activated ($(gcc --version | head -1))"

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
if command -v cmake3 >/dev/null; then
  ln -sf "$(command -v cmake3)" /usr/local/bin/cmake
fi

# Persist devtoolset on PATH for subsequent Dockerfile RUN steps; the
# enable script exports PATH + LD_LIBRARY_PATH + MANPATH + INFOPATH +
# PCP_DIR + PKG_CONFIG_PATH.
echo '. /opt/rh/devtoolset-10/enable' > /etc/profile.d/devtoolset-10.sh

# Image-size trim. manylinux2014 ships ~1.4 GB of stuff we don't use:
# 6 Python versions, pip caches, wheel build infra, locale data,
# manylinux's bundled OpenSSL, docs, debug symbols, gcc-internals for
# languages (Fortran/Go-from-gcc) we don't compile. The whole trim
# runs in ONE `RUN` layer so the deletes actually shrink the image
# (rm in a later layer leaves a delete-marker; the parent layer
# keeps the bytes).
echo "→ image-size trim"

yum clean all

# Big-ticket dirs in one rm — these are independent and each is
# 100s of MB. One scatter syscall is plenty.
rm -rf \
  /opt/_internal \
  /opt/python \
  /root/.cache \
  /usr/local/share/doc \
  /usr/local/share/man \
  /usr/share/doc \
  /usr/share/gtk-doc \
  /usr/share/help \
  /usr/share/info \
  /usr/share/man \
  /var/cache/dnf \
  /var/cache/yum \
  /var/lib/yum/yumdb \
  /var/log/yum.log

# SCL siblings: manylinux variants sometimes ship devtoolset-{11,12}.
# We pin to 10; drop everything else under /opt/rh.
find /opt/rh -mindepth 1 -maxdepth 1 -type d ! -name devtoolset-10 \
  -exec rm -rf {} +

# devtoolset-10 internals we don't compile against — gfortran (Fortran),
# gccgo (gcc's Go front-end, distinct from `golang` RPM), gdb. Drop the
# binaries + their gcc backends. Saves ~70 MB. The `${DTS10:?}` guard
# is shellcheck SC2115 — never let a partial expansion delete /usr/share.
DTS10=/opt/rh/devtoolset-10/root
rm -rf \
  "${DTS10:?}"/usr/bin/{gfortran,gccgo,gdb,gdbserver,gdb-add-index} \
  "${DTS10:?}"/usr/libexec/gcc/*/*/{f951,go1,cgo} \
  "${DTS10:?}"/usr/lib*/libgfortran* \
  "${DTS10:?}"/usr/lib*/libgo* \
  "${DTS10:?}"/usr/share

# Strip debug symbols from runtime libs we'll actually link against.
# DO NOT strip /lib64/ld-linux*.so.* (the dynamic linker) — `strip`
# can corrupt the PT_INTERP that everything else depends on. Limit
# to libstdc++ / libgcc / devtoolset libs. ~30-50 MB.
find /usr/lib /usr/lib64 "${DTS10}"/usr/lib* \
  \( -name "libstdc++.so*" -o -name "libgcc_s.so*" -o -name "libgomp.so*" \) \
  -type f -exec strip --strip-unneeded {} + || true

# Python stdlib bytecode caches + test suites (in case a python3 RPM
# landed via dependencies). Use a glob first so `find` doesn't fail
# when no python dirs exist.
shopt -s nullglob
PY_DIRS=(/usr/lib/python* /usr/lib64/python*)
shopt -u nullglob
if [ "${#PY_DIRS[@]}" -gt 0 ]; then
  find "${PY_DIRS[@]}" \
    \( -name __pycache__ -o -name test -o -name tests \) \
    -type d -prune -exec rm -rf {} + || true
fi

# Locale data: keep en_US.UTF-8 only. `localedef --delete-from-archive`
# trims the binary locale-archive in-place; the per-language .mo files
# (gettext message catalogs) under /usr/share/locale are separate.
if command -v localedef >/dev/null; then
  localedef --list-archive 2>/dev/null \
    | grep -v "^en_US\(\.utf8\|\.UTF-8\)\?$" \
    | xargs -r localedef --delete-from-archive 2>/dev/null || true
fi
if [ -d /usr/share/locale ]; then
  find /usr/share/locale -mindepth 1 -maxdepth 1 -type d ! -name 'en*' \
    -exec rm -rf {} +
fi

echo "✓ setup-linux-build complete ($(du -sh / 2>/dev/null | awk '{print $1}'))"
