# btm-builder-glibc — fleet-shared base image for every glibc Linux builder.
#
# Why almalinux:8: glibc 2.28 floor + gcc-toolset-13 (GCC 13 — Node 26
# needs >= 13.2) + Node binaries from nodejs.org/dist run natively.
# Shipped artifacts use packages/glibc-shims-infra `--wrap=` ldflags so
# they run on glibc 2.17 hosts; the shims are wired into each builder's
# Makefile/cmake build, not into this image.
#
# Published as `ghcr.io/socketdev/btm-builder-glibc:YYYY-MM-DD-<sha8>`
# by .github/workflows/btm-builder-image.yml. The publish workflow
# refreshes the FROM digest below + bumps the soak annotation.

# almalinux:8.10-20251111
# published: 2025-11-11 | removable: 2025-11-18
FROM almalinux:8 AS build

ARG CACHE_VERSION=unset
ARG NODE_VERSION
ARG PNPM_ASSET
ARG PNPM_SHA512
ARG PNPM_VERSION

# Bash for `.` source + heredocs etc. Downstream RUN steps inherit /bin/sh
# (Dockerfile SHELL is per-file); they MUST use POSIX `.` not bash `source`.
SHELL ["/bin/bash", "-c"]

# --- Layer 1: toolchain install + trim (rarely changes — only on package set bump) ---
# BuildKit cache mount on /var/cache/dnf persists metadata across builds.
RUN --mount=type=cache,target=/var/cache/dnf,sharing=locked \
    set -euo pipefail && \
    echo "btm-builder-glibc cache: ${CACHE_VERSION}" && \
    dnf -y install dnf-plugins-core epel-release && \
    dnf config-manager --set-enabled powertools && \
    dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo && \
    dnf -y --setopt=install_weak_deps=False install \
        ca-certificates \
        ccache \
        cmake \
        curl \
        file \
        gcc-toolset-13 \
        gcc-toolset-13-binutils \
        gcc-toolset-13-binutils-gold \
        gcc-toolset-13-gcc \
        gcc-toolset-13-gcc-c++ \
        gcc-toolset-13-libstdc++-devel \
        gh \
        git \
        glibc-static \
        golang \
        jq \
        libatomic \
        liburing-devel \
        make \
        ninja-build \
        openssl-devel \
        patch \
        perl \
        pkgconfig \
        procps-ng \
        python3.11 \
        wget \
        which \
        xz \
        xz-devel \
        zlib-devel \
        zlib-static && \
    # Persist gcc-toolset-13 on PATH for downstream RUN steps via BASH_ENV.
    echo '. /opt/rh/gcc-toolset-13/enable' > /etc/profile.d/gcc-toolset-13.sh && \
    # Big-ticket trim. Sizes from probing almalinux:8 base + installed set.
    # /var/cache/dnf is on a BuildKit cache mount above — no image bytes; not listed here.
    rm -rf \
      /root/.cache \
      /usr/local/share/doc \
      /usr/local/share/man \
      /usr/share/X11 \
      /usr/share/cracklib \
      /usr/share/doc \
      /usr/share/fonts \
      /usr/share/gtk-doc \
      /usr/share/help \
      /usr/share/hwdata \
      /usr/share/i18n \
      /usr/share/info \
      /usr/share/man \
      /usr/share/mime \
      /var/lib/yum/yumdb \
      /var/log/dnf.log \
      /var/log/dnf.rpm.log \
      /var/log/yum.log && \
    # gcc-toolset-13 internals: drop Fortran, Go-from-gcc, debug/profile
    # tools, 32-bit multilib. KEEP lto1 (lief uses
    # -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON), KEEP libisl (gcc loads
    # it for graphite at -O3), KEEP libstdc++.a / libgcc.a (binsuite
    # static linking).
    GCC_ROOT=/opt/rh/gcc-toolset-13/root && \
    rm -rf \
      "${GCC_ROOT:?}"/usr/bin/{dwp,dwz,gccgo,gcov,gcov-dump,gcov-tool,gdb,gdb-add-index,gdbserver,gfortran,gprof,lto-dump} \
      "${GCC_ROOT:?}"/usr/libexec/gcc/*/*/{cgo,f951,go1} \
      "${GCC_ROOT:?}"/usr/lib*/libgfortran* \
      "${GCC_ROOT:?}"/usr/lib*/libgo* \
      "${GCC_ROOT:?}"/usr/lib/gcc/*/13/32 \
      "${GCC_ROOT:?}"/usr/lib/gcc/*/13/finclude \
      "${GCC_ROOT:?}"/usr/lib/gcc/*/13/lib{caf_single,gfortran,quadmath}* \
      "${GCC_ROOT:?}"/usr/share && \
    # Locale + zoneinfo: keep en_US.UTF-8 + UTC.
    if command -v localedef >/dev/null; then \
      localedef --list-archive 2>/dev/null \
        | grep -v "^en_US\(\.utf8\|\.UTF-8\)\?$" \
        | xargs -r localedef --delete-from-archive 2>/dev/null || true; \
    fi && \
    if [ -d /usr/share/locale ]; then \
      find /usr/share/locale -mindepth 1 -maxdepth 1 -type d ! -name 'en*' -exec rm -rf {} +; \
    fi && \
    if [ -d /usr/share/zoneinfo ]; then \
      find /usr/share/zoneinfo -mindepth 1 -maxdepth 1 \
        ! -name UTC ! -name 'zone*' ! -name iso3166.tab ! -name tzdata.zi \
        -exec rm -rf {} +; \
    fi && \
    # Strip dynamic libs. --strip-unneeded preserves linking surface.
    find /usr/lib /usr/lib64 "${GCC_ROOT}"/usr/lib* \
      \( -name "libstdc++.so*" -o -name "libgcc_s.so*" -o -name "libgomp.so*" \) \
      -type f -exec strip --strip-unneeded {} + 2>/dev/null || true

# --- Layer 2: Node + pnpm (changes more often — separate layer for cache reuse) ---
RUN set -euo pipefail && \
    ARCH=$(uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/') && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.xz" \
      | tar -xJ -C /usr/local --strip-components=1 && \
    curl -fsSL -o /tmp/pnpm.tar.gz "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/${PNPM_ASSET}" && \
    echo "${PNPM_SHA512}  /tmp/pnpm.tar.gz" | sha512sum -c - && \
    tar -xzf /tmp/pnpm.tar.gz -C /usr/local/bin && \
    rm /tmp/pnpm.tar.gz
    # DO NOT strip /usr/local/bin/{node,pnpm} — both are SEA bundles
    # with embedded data sections that `strip` corrupts. Verified
    # empirically: stripped pnpm fails with
    # "Inconsistency detected by ld.so: rtld.c: 1657: dl_main:
    # Assertion `GL(dl_rtld_map).l_libname' failed!". The few extra
    # MB of debug info are worth the working binary.

ENV BASH_ENV=/etc/profile.d/gcc-toolset-13.sh
