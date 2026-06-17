# BoringSSL headers (staged)

This directory holds the prefixed BoringSSL include tree (`openssl/*.h`
and friends) that lsquic + uWebSockets compile against in
`node:smol-http`.

The headers are produced by `packages/boringssl-builder/` with
`-DBORINGSSL_PREFIX=smol`. `prepare-external-sources.mts` copies the
upstream `include/` tree here at build-prepare time via
`copyBoringsslArtifacts()`. The dir is otherwise empty in version
control — this README is the placeholder.

Do not commit the `.h` files; they're staged build inputs and
regenerate on every CI run.
