# OpenSSL/crypto static library detection for Linux builds.
# On musl (Alpine): libcrypto.a is provided by openssl-libs-static.
# On glibc (AlmaLinux 8): libcrypto.a must be built from source to /usr/local/ssl.
#
# Usage: include this file and add $(CRYPTO_LDFLAGS) to your LDFLAGS.

# Check if libcrypto.a exists at the pkg-config reported location.
# If it does (musl), use pkg-config flags for proper static linking.
# If not (glibc), fall back to /usr/local/ssl where Dockerfiles build it from source.
CRYPTO_LDFLAGS := $(shell \
  PCDIR=$$(pkg-config --variable=libdir libcrypto 2>/dev/null); \
  if [ -n "$$PCDIR" ] && [ -f "$$PCDIR/libcrypto.a" ]; then \
    pkg-config --static --libs libcrypto; \
  else \
    echo "-L/usr/local/ssl/lib -L/usr/local/ssl/lib64 -lcrypto -lpthread -ldl"; \
  fi)
