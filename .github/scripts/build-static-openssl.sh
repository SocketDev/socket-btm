#!/bin/sh
set -eu
# Build static OpenSSL 3.5.0 for glibc Docker builds (AlmaLinux 8 lacks libcrypto.a).
OPENSSL_VERSION="3.5.0"
PREFIX="/usr/local/ssl"

if [ -f "$PREFIX/lib/libcrypto.a" ] || [ -f "$PREFIX/lib64/libcrypto.a" ]; then
  echo "Static OpenSSL already built at $PREFIX"
  exit 0
fi

echo "Building static OpenSSL $OPENSSL_VERSION..."
curl -fsSL "https://github.com/openssl/openssl/releases/download/openssl-${OPENSSL_VERSION}/openssl-${OPENSSL_VERSION}.tar.gz" | tar xz -C /tmp
cd "/tmp/openssl-${OPENSSL_VERSION}"
./Configure no-shared no-tests --prefix="$PREFIX" --openssldir="$PREFIX"
make -j"$(nproc)"
make install_sw
cd /
rm -rf "/tmp/openssl-${OPENSSL_VERSION}"
echo "Static OpenSSL $OPENSSL_VERSION installed to $PREFIX"
