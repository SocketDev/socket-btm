# libpq-builder

Builds libpq (the PostgreSQL client library) with OpenSSL support so node-smol's `node:smol-sql` module can talk to Postgres directly without shelling out or loading a system shared library. Prefers a prebuilt artifact from GitHub releases; falls back to a from-source build when none matches the current platform.
