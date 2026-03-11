#!/bin/bash
# Generate version from date and git SHA: YYYYMMDD-{short-sha}
#
# Usage in GitHub Actions:
#   - name: Generate version
#     id: version
#     run: |
#       source .github/scripts/generate-version.sh
#       echo "version=$VERSION" >> $GITHUB_OUTPUT
#       echo "Version: $VERSION"

set -euo pipefail

DATE_PART=$(date -u +"%Y%m%d")
GIT_SHA=$(git rev-parse --short=7 HEAD)
export VERSION="${DATE_PART}-${GIT_SHA}"

# For direct execution (testing)
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  echo "$VERSION"
fi
