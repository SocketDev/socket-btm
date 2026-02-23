#!/usr/bin/env bash
# Generate SHA-256 checksums for files in a directory
#
# Usage:
#   generate-checksums.sh <directory> [output-file]
#
# Arguments:
#   directory    - Directory containing files to checksum
#   output-file  - Output file for checksums (default: checksums.txt)
#
# Examples:
#   generate-checksums.sh dist/
#   generate-checksums.sh dist/ checksums.txt

set -euo pipefail

# Validate arguments
if [ $# -lt 1 ] || [ $# -gt 2 ]; then
  echo "Usage: $0 <directory> [output-file]" >&2
  exit 1
fi

DIR="${1}"
OUTPUT="${2:-checksums.txt}"

# Validate directory exists
if [ ! -d "$DIR" ]; then
  echo "Error: Directory does not exist: $DIR" >&2
  exit 1
fi

# Detect cross-platform SHA-256 command
if command -v shasum &> /dev/null; then
  HASH_CMD="shasum -a 256"
elif command -v sha256sum &> /dev/null; then
  HASH_CMD="sha256sum"
else
  echo "Error: No SHA-256 command found (tried: shasum, sha256sum)" >&2
  exit 1
fi

# Generate checksums
cd "$DIR"
$HASH_CMD * > "$OUTPUT"

echo "Generated checksums: $DIR/$OUTPUT"
