# curl-builder

Provides libcurl + mbedTLS for our self-extracting stub binaries so they can download payloads over HTTPS without relying on a system curl. By default, the builder downloads a prebuilt artifact from GitHub releases (fast); with `FORCE_BUILD=1` it compiles from the upstream `curl` submodule with mbedTLS statically linked.

Consumed by stubs-builder. If you are adding TLS features or bumping curl, see `.claude/skills/updating-curl/SKILL.md`.
