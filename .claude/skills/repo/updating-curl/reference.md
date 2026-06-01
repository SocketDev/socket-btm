# updating-curl Reference Documentation

This document provides edge cases, troubleshooting, and additional context for the updating-curl skill.

## Tag Format Reference

### curl Tags
- Format: `curl-X_Y_Z` (e.g., `curl-8_18_0`)
- Human-readable: `8.18.0` (convert underscores to dots, remove prefix)
- Exclude: Any tag with `rc`, `alpha`, `beta`

### mbedtls Tags
- Format: `vX.Y.Z` (e.g., `v3.6.5`) or `mbedtls-X.Y.Z`
- Prefer `vX.Y.Z` format (more common)
- Exclude: Any tag with `rc`, `alpha`, `beta`

## Cache Version Dependencies

When updating curl, only the `curl` cache version needs to be bumped:

```json
{
  "versions": {
    "curl": "v17"  // ← Bump this
  }
}
```

curl is a leaf dependency - no other packages depend on curl for their builds.

## Edge Cases

### Already on Latest Version

**Detection:**
```bash
if [ "$CURL_CURRENT" = "$CURL_LATEST" ] && [ "$MBEDTLS_CURRENT" = "$MBEDTLS_LATEST" ]; then
  echo "curl and mbedtls already at latest versions"
  exit 0
fi
```

### Only curl Needs Update

If only curl has a new version but mbedtls doesn't, still update both to ensure compatibility. Always check mbedtls for updates when updating curl.

### mbedtls API Changes

mbedtls occasionally has API changes between versions. If build fails after update:
1. Check mbedtls release notes for breaking changes
2. Review curl's mbedtls usage for compatibility
3. May need to update curl-builder code

## Rollback Procedures

### Rollback After Commit

```bash
git reset --hard HEAD~1
```

### Rollback After Push

```bash
# Safe option: revert
git revert HEAD
git push origin main

# Destructive option: force push (coordinate with team)
git reset --hard HEAD~1
git push --force origin main
```

## Troubleshooting

### Build Fails with TLS Errors

**Symptom:**
```
undefined reference to `mbedtls_ssl_*`
```

**Cause:** mbedtls API changed between versions.

**Solution:**
1. Check mbedtls changelog for breaking changes
2. Update curl-builder code to use new API
3. Or rollback to previous mbedtls version

### Build Fails with curl Errors

**Symptom:**
```
undefined reference to `curl_*`
```

**Cause:** curl API changed or deprecated function used.

**Solution:**
1. Check curl changelog for breaking changes
2. Update curl-builder code to use new API

### Tests Fail

**Common causes:**
- HTTP behavior changed in new curl version
- TLS handshake behavior changed
- Certificate handling changed

**Solution:**
- Review test failures for specific issues
- Update test expectations if behavior change is expected
- Or rollback if regression
