# BoringSSL static libs (staged)

This directory holds the prefixed BoringSSL static libraries
(`libsmol_crypto.a`, `libsmol_ssl.a` on Unix; `smol_crypto.lib`,
`smol_ssl.lib` on MSVC) that link into `node:smol-http`'s transport
stack (lsquic + uWebSockets).

The libs are produced by `packages/boringssl-builder/` with
`-DBORINGSSL_PREFIX=smol`. `prepare-external-sources.mts` copies them
here at build-prepare time via `copyBoringsslArtifacts()`. The dir is
otherwise empty in version control — this README is the placeholder.

Do not commit the `.a` / `.lib` files; they're build artifacts and
regenerate on every CI run.
