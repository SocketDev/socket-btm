# btm-builder-glibc — fleet-shared base image for every glibc Linux builder.
#
# Every builder in this repo (boringssl, binsuite, curl, lief, node-smol,
# stubs) starts from this prebake. Consolidates ~7 different per-builder
# `dnf install` blocks into one image; downstream Dockerfiles become 5–10
# lines of `FROM ghcr.io/... + COPY + RUN node scripts/build.mts`.
#
# Why almalinux:8: glibc 2.28 floor + gcc-toolset-13 (GCC 13 for Node 26
# C++20 requirement) + Node 22+ binaries from nodejs.org/dist run natively.
# Final shipped artifacts use packages/glibc-shims-infra (--wrap=getrandom,
# quick_exit, etc.) so they run on glibc 2.17 hosts at runtime.
#
# Published as `ghcr.io/socketdev/btm-builder-glibc:YYYY-MM-DD-<sha8>`
# by .github/workflows/btm-builder-image.yml (date-immutable, never `latest`).
#
# To refresh: bump the FROM digest below + run the publish workflow.
# Soak-policy annotation (lib/soak-policy.mts) gates new pins.

# almalinux:8.10-20251111 (digest captured by build-builder-image.mts)
# published: 2025-11-11 | removable: 2025-11-18
FROM almalinux:8 AS build

# --- Argument plumbing for cache invalidation + build flags ---
ARG CACHE_VERSION=unset
ARG NODE_VERSION
ARG PNPM_VERSION
ARG PNPM_ASSET
ARG PNPM_SHA256

# --- Single RUN layer: install + trim ---
# One RUN so deletes actually shrink the image. A later `RUN rm` would
# leave delete-markers but the install layer keeps the bytes.
RUN set -euo pipefail && \
    echo "→ btm-builder-glibc cache: ${CACHE_VERSION}" && \
    # ===== Install =====
    # Disable weak deps (drops optional GUI/pinentry/etc., saves ~150 MB).
    dnf -y --setopt=install_weak_deps=False update && \
    dnf -y --setopt=install_weak_deps=False install \
        epel-release \
        dnf-plugins-core && \
    dnf config-manager --set-enabled powertools && \
    # Toolchain + build tools (union of every fleet builder's needs).
    # gcc-toolset-13: GCC 13 (Node 26 needs >= 13.2). devtoolset is RHEL-7-only.
    dnf -y --setopt=install_weak_deps=False install \
        ca-certificates \
        ccache \
        cmake \
        curl \
        gcc-toolset-13 \
        gcc-toolset-13-gcc \
        gcc-toolset-13-gcc-c++ \
        gcc-toolset-13-libstdc++-devel \
        gcc-toolset-13-binutils \
        git \
        jq \
        libatomic \
        liburing-devel \
        ninja-build \
        openssl-devel \
        patch \
        perl \
        procps-ng \
        python3.11 \
        python3.11-pip \
        which \
        xz \
        xz-devel \
        zlib-devel \
        zlib-static && \
    # ===== Install Node from nodejs.org/dist =====
    # NodeSource CDN reorganized 2026-05-28 (pub_current.x 404s). Pin via
    # build-arg passed from publish workflow (single source of truth in
    # .node-version at repo root; workflow reads + injects).
    ARCH=$(uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/') && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.xz" \
      | tar -xJ -C /usr/local --strip-components=1 && \
    # ===== Install pnpm from GitHub releases =====
    # Asset name + sha256 passed from publish workflow (single source of
    # truth: socket-registry's tool-checksums; workflow reads + injects).
    curl -fsSL -o /tmp/pnpm.tar.gz "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/${PNPM_ASSET}" && \
    echo "${PNPM_SHA256}  /tmp/pnpm.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/pnpm.tar.gz -C /usr/local/bin && \
    rm /tmp/pnpm.tar.gz && \
    # ===== Persist gcc-toolset-13 on PATH =====
    # Subsequent RUN steps in downstream Dockerfiles inherit via BASH_ENV.
    # Interactive shells pick it up from /etc/profile.d/.
    echo '. /opt/rh/gcc-toolset-13/enable' > /etc/profile.d/gcc-toolset-13.sh && \
    # ===== Trim =====
    # Sizes from probing almalinux:8 base. Order: yum cleanup → big-ticket
    # dirs → fine-grained pruning → strip. KEEP libstdc++.a, libgcc.a etc.
    # (needed for -static-libstdc++/-static-libgcc in binject + co).
    dnf clean all && \
    rm -rf \
      /root/.cache \
      /tmp/pnpm.tar.gz \
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
      /var/cache/dnf \
      /var/cache/yum \
      /var/lib/yum/yumdb \
      /var/log/dnf.log /var/log/dnf.rpm.log /var/log/yum.log && \
    # ===== gcc-toolset-13 trim =====
    # Drop Fortran, Go-from-gcc, debug tools, gcov (we don't profile builds),
    # 32-bit multilib (we only build x86_64 / arm64). KEEP lto1 (lief uses
    # -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON), KEEP libisl (gcc loads it
    # for graphite passes at -O3).
    GCC_ROOT=/opt/rh/gcc-toolset-13/root && \
    rm -rf \
      "${GCC_ROOT:?}"/usr/bin/{dwp,gccgo,gcov,gcov-dump,gcov-tool,gdb,gdb-add-index,gdbserver,gfortran,gprof} \
      "${GCC_ROOT:?}"/usr/libexec/gcc/*/*/{cgo,f951,go1} \
      "${GCC_ROOT:?}"/usr/lib*/libgfortran* \
      "${GCC_ROOT:?}"/usr/lib*/libgo* \
      "${GCC_ROOT:?}"/usr/lib/gcc/*/13/32 \
      "${GCC_ROOT:?}"/usr/lib/gcc/*/13/finclude \
      "${GCC_ROOT:?}"/usr/lib/gcc/*/13/lib{caf_single,gfortran,quadmath}* \
      "${GCC_ROOT:?}"/usr/share && \
    # ===== Locale + zoneinfo =====
    # Keep en_US.UTF-8 only. Builds use UTC; nothing reads localized TZ.
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
    # ===== Strip dynamic libs (KEEP --strip-unneeded — preserves linking) =====
    find /usr/lib /usr/lib64 "${GCC_ROOT}"/usr/lib* \
      \( -name "libstdc++.so*" -o -name "libgcc_s.so*" -o -name "libgomp.so*" \) \
      -type f -exec strip --strip-unneeded {} + 2>/dev/null || true && \
    # ===== Final size print =====
    echo "✓ btm-builder-glibc final size: $(du -sh / 2>/dev/null | awk '{print $1}')"

# Every downstream RUN inherits gcc-toolset-13 + PATH via BASH_ENV.
ENV BASH_ENV=/etc/profile.d/gcc-toolset-13.sh
SHELL ["/bin/bash", "-c"]

# Downstream builders set WORKDIR + COPY + RUN. This image only provides
# the toolchain.
