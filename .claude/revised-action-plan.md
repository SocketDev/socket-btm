# Revised Action Plan: Build Infrastructure

Based on critical review findings, this document outlines the revised approach for socket-btm build optimization.

## Executive Summary

**Critical Review Verdict**: The original proposal had **5 critical issues** that must be fixed before proceeding, plus **optimistic time estimates** (7-11 hours → 18-27 hours realistic).

**Key Finding**: The caching implementation already delivers 95%+ of the value. The build-infra abstraction adds complexity that may not justify the maintenance burden.

**Revised Recommendation**:
1. **Fix critical caching issues immediately** (P0)
2. **Evaluate composite actions** as simpler alternative to Node.js library
3. **Stop after Phase 2** (Ninja/Python) - leave Windows logic inline

---

## Critical Issues Found

### 🚨 P0 Critical (Must Fix Immediately)

#### Issue #1: Cache Key Missing Node.js Version

**Problem**: Cache key doesn't include NODE_VERSION, causing version mismatches:
```yaml
# Current (BROKEN)
key: node-smol-release-${{ matrix.platform }}-${{ matrix.arch }}-${{ steps.cache-key.outputs.hash }}

# If NODE_VERSION changes 22→23, cache key stays same
# Workflow restores Node 22 binary, publishes as Node 23
```

**Fix**: (1 hour)
```yaml
key: node-smol-release-${{ matrix.platform }}-${{ matrix.arch }}-v${{ env.NODE_VERSION }}-${{ steps.cache-key.outputs.hash }}
```

**Add validation**:
```bash
EXPECTED_VERSION="${{ env.NODE_VERSION }}"
ACTUAL_VERSION=$("$BINARY_PATH" --version | grep -oP 'v\K[0-9]+')
if [ "$ACTUAL_VERSION" != "$EXPECTED_VERSION" ]; then
  echo "✗ Version mismatch"
  rm -rf build/
  exit 1
fi
```

#### Issue #2: Windows PATH Mutation

**Problem**: Proposed code mutates `process.env.PATH` globally (violates CLAUDE.md principles):
```javascript
// DANGEROUS - don't do this
process.env.PATH = `${gitUnixPath};${process.env.PATH}`
```

**Fix**: (2 hours) Return PATH modification for caller to apply:
```javascript
export function getGitUnixToolsPath() {
  return {
    path: 'C:\\Program Files\\Git\\usr\\bin',
    prepend: true
  }
}

// Usage
const { path: gitPath } = getGitUnixToolsPath()
spawn('patch', args, {
  env: { ...process.env, PATH: `${gitPath};${process.env.PATH}` }
})
```

#### Issue #3: vcvarsall.bat Parsing Fragility

**Problem**: Parser relies on form feed character (`\f`) which breaks on non-English Windows:
```javascript
const sections = result.stdout.split('\f')  // Breaks on Chinese Windows
```

**Fix**: (3 hours) Add robust fallback parser:
```javascript
// Fallback: parse SET commands directly
const envVars = {}
for (const line of result.stdout.split('\n')) {
  const match = line.match(/^SET\s+([^=]+)=(.*)$/i)
  if (match) {
    envVars[match[1]] = match[2]
  }
}

// Validate parsed paths exist
for (const varName of criticalVars) {
  if (newEnv[varName] && !fs.existsSync(newEnv[varName].split(';')[0])) {
    throw new Error(`Parsed ${varName} contains invalid path`)
  }
}
```

#### Issue #4: No Error Recovery in Toolchain Setup

**Problem**: Network failures during `brew install ninja` fail entire workflow, no retry logic.

**Fix**: (3 hours) Add exponential backoff:
```javascript
export async function setupNinja({ maxRetries = 3 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await ensureToolInstalled('ninja', { autoInstall: true })
    if (result.available) {
      return { available: true, installed: true }
    }

    if (attempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  // Fallback to Make
  return { available: false, installed: false }
}
```

#### Issue #5: No Rollback Strategy

**Problem**: If build-infra breaks production, no easy escape hatch.

**Fix**: (2 hours) Add feature flag:
```yaml
env:
  USE_BUILD_INFRA: ${{ vars.USE_BUILD_INFRA || 'false' }}

- name: Setup toolchain (new)
  if: env.USE_BUILD_INFRA == 'true'
  run: # ... build-infra approach

- name: Setup toolchain (legacy)
  if: env.USE_BUILD_INFRA != 'true'
  run: # ... existing inline logic
```

---

## Revised Approach: Composite Actions

### Why Composite Actions?

**Comparison**:

| Approach | Complexity | Testing | Rollback | Recommendation |
|----------|-----------|---------|----------|----------------|
| Node.js Library | High | Hard | Hard | ⚠️ Too complex |
| **Composite Actions** | Medium | Easy | Easy | ✅ **Recommended** |
| Inline Workflow | Low | Easy | N/A | ✅ Valid (status quo) |

**Benefits of Composite Actions**:
- ✅ Native GitHub Actions integration
- ✅ Easier to test in workflows
- ✅ No Node.js execution required
- ✅ Better caching support
- ✅ Easy rollback (just change action version)

**Drawbacks**:
- ❌ Not reusable outside GitHub Actions
- ❌ Still requires maintenance

### Example: Ninja Setup as Composite Action

**File**: `.github/actions/setup-ninja/action.yml`

```yaml
name: Setup Ninja
description: Install Ninja build system with caching support

inputs:
  required:
    description: Exit if Ninja not available
    default: 'false'

outputs:
  ninja-path:
    description: Path to Ninja binary
    value: ${{ steps.check.outputs.path }}
  available:
    description: Whether Ninja is available
    value: ${{ steps.check.outputs.available }}

runs:
  using: composite
  steps:
    - name: Check if Ninja already installed
      id: check
      shell: bash
      run: |
        if command -v ninja &>/dev/null; then
          echo "available=true" >> $GITHUB_OUTPUT
          echo "path=$(command -v ninja)" >> $GITHUB_OUTPUT
        else
          echo "available=false" >> $GITHUB_OUTPUT
        fi

    - name: Cache Ninja binary (macOS)
      if: runner.os == 'macOS' && steps.check.outputs.available != 'true'
      uses: actions/cache@v4
      with:
        path: |
          /usr/local/bin/ninja
          /opt/homebrew/bin/ninja
        key: ninja-macos-${{ runner.arch }}

    - name: Install Ninja (macOS)
      if: runner.os == 'macOS' && steps.check.outputs.available != 'true'
      shell: bash
      run: brew install ninja

    - name: Cache Ninja binary (Linux)
      if: runner.os == 'Linux' && steps.check.outputs.available != 'true'
      uses: actions/cache@v4
      with:
        path: /usr/bin/ninja
        key: ninja-linux-${{ runner.arch }}

    - name: Install Ninja (Linux)
      if: runner.os == 'Linux' && steps.check.outputs.available != 'true'
      shell: bash
      run: sudo apt-get update && sudo apt-get install -y ninja-build

    - name: Cache Ninja binary (Windows)
      if: runner.os == 'Windows' && steps.check.outputs.available != 'true'
      uses: actions/cache@v4
      with:
        path: C:\ProgramData\chocolatey\bin\ninja.exe
        key: ninja-windows-${{ runner.arch }}

    - name: Install Ninja (Windows)
      if: runner.os == 'Windows' && steps.check.outputs.available != 'true'
      shell: pwsh
      run: choco install ninja -y

    - name: Verify installation
      shell: bash
      run: |
        if command -v ninja &>/dev/null; then
          echo "✓ Ninja installed: $(ninja --version)"
        elif [ "${{ inputs.required }}" = "true" ]; then
          echo "✗ Ninja installation failed"
          exit 1
        fi
```

**Usage in workflow**:
```yaml
- name: Setup Ninja
  uses: ./.github/actions/setup-ninja
  with:
    required: 'true'
```

---

## Revised Implementation Plan

### Phase 0: Fix Critical Caching Issues (11 hours) - **DO FIRST**

**Priority**: P0 Critical

**Tasks**:
1. ✅ Add NODE_VERSION to cache key (1 hour)
2. ✅ Add version validation in smoke test (1 hour)
3. ✅ Test cache invalidation on version bump (2 hours)
4. ✅ Add rollback feature flag (2 hours)
5. ✅ Document cache key strategy (2 hours)
6. ✅ Test on all 8 platforms (3 hours)

**Deliverables**:
- Updated `.github/workflows/release.yml` with version in cache key
- Version validation in smoke test step
- Feature flag for easy rollback
- Updated `docs/caching-strategy.md`

**Risk Level**: LOW - Non-breaking changes, additive only

---

### Phase 1: Ninja Setup via Composite Action (6 hours) - **OPTIONAL**

**Priority**: P2 Medium

**Decision Point**: Evaluate if Ninja abstraction is worth it
- Current: 37 lines inline per platform (111 total)
- With composite action: 1 line per platform (3 total)
- Savings: 108 lines, but adds action to maintain

**Tasks**:
1. Create `.github/actions/setup-ninja/action.yml` (3 hours)
2. Update workflow to use action (1 hour)
3. Test on all platforms (2 hours)

**Deliverables**:
- Composite action for Ninja setup
- Updated workflow using action
- Documentation in action README

**Risk Level**: LOW - Easy to rollback, self-contained

---

### Phase 2: Python Setup via Composite Action (4 hours) - **OPTIONAL**

**Priority**: P3 Low

**Tasks**:
1. Create `.github/actions/setup-python-for-node/action.yml` (2 hours)
2. Update workflow to use action (1 hour)
3. Test on all platforms (1 hour)

**Deliverables**:
- Composite action for Python setup
- Updated workflow using action

**Risk Level**: LOW - Python setup already works, just abstracting

---

### Phase 3: Windows Toolchain - **SKIP FOR NOW**

**Priority**: P4 Deferred

**Rationale**:
- Windows setup is 150+ lines but only needed for 2/8 platforms
- High complexity, low ROI
- Current inline approach works fine
- Risk of breaking Windows builds outweighs benefits

**Re-evaluate if**:
- Multiple workflows need Windows builds (WASM, SEA)
- Windows setup breaks frequently
- Team requests abstraction for testing

---

## Revised Timeline

### Week 1: Critical Fixes (11 hours)
- [ ] Monday-Tuesday: Fix cache key + validation (4 hours)
- [ ] Wednesday: Add rollback strategy (2 hours)
- [ ] Thursday: Documentation updates (2 hours)
- [ ] Friday: Full platform testing (3 hours)

### Week 2: Evaluation (2 hours)
- [ ] Monday: Review Phase 0 results
- [ ] Tuesday: **Decision point**: Proceed with Phase 1 (Ninja) or stop here?

### Week 3: Optional Ninja Abstraction (6 hours)
- [ ] Only if decided to proceed
- [ ] Monday-Tuesday: Create composite action (4 hours)
- [ ] Wednesday: Test on all platforms (2 hours)

### Total: 11-17 hours (vs original 18-27 hours)

---

## Decision Framework

### When to Stop

**Stop after Phase 0 if**:
- ✅ Caching works reliably on all platforms
- ✅ Build times meet expectations (<2 min cache hit, <60 min cache miss)
- ✅ No frequent toolchain setup failures
- ✅ Team comfortable with inline workflow logic

**Proceed to Phase 1 if**:
- ❌ Planning WASM/SEA workflows that need same toolchain
- ❌ Ninja setup fails frequently (network issues, version conflicts)
- ❌ Team wants better testability

**Proceed to Phase 2 if**:
- ❌ Multiple workflows need Python version management
- ❌ Python version conflicts causing issues

**Proceed to Phase 3 (Windows) if**:
- ❌ Windows builds break frequently
- ❌ Multiple workflows need Windows toolchain
- ❌ Team has dedicated Windows expertise

---

## Updated Recommendations

### Immediate (This Week)

1. **Fix cache key to include NODE_VERSION** ← Most critical
2. **Add version validation in smoke test**
3. **Add rollback feature flag**
4. **Test thoroughly on all 8 platforms**

### Short Term (Next 2 Weeks)

5. **Evaluate Phase 1 (Ninja)** - Is abstraction worth it?
6. **Make go/no-go decision** on composite actions
7. **If yes**: Implement Ninja composite action only

### Medium Term (Re-evaluate in 1 Month)

8. **Assess Phase 0 success** - Did caching deliver value?
9. **Measure build time improvements** - 95%+ savings on cache hits?
10. **Decide on Python abstraction** - Needed or nice-to-have?

### Long Term (3+ Months)

11. **Re-evaluate Windows abstraction** - Still needed?
12. **Consider build-infra Node.js library** - If 3+ workflows need toolchain
13. **Explore Docker toolchain** - For Linux builds only

---

## Success Metrics

### Phase 0 (Critical Fixes)

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Cache hit rate | >80% | GitHub Actions cache insights |
| Cache hit build time | <2 min | Build metrics artifact |
| Cache miss build time | <60 min | Build metrics artifact |
| Version mismatch incidents | 0 | Manual testing + production monitoring |
| Rollback time (if needed) | <5 min | Feature flag toggle |

### Phase 1 (Ninja - Optional)

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Workflow line reduction | >100 lines | Git diff |
| Ninja install success rate | >95% | CI logs |
| Action reusability | Used in 2+ workflows | Git grep |

---

## Risk Mitigation

### Phase 0 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Cache key change breaks existing caches | High | Low | Acceptable (caches expire anyway) |
| Version validation too strict | Medium | Medium | Make configurable via env var |
| Platform-specific cache issues | Low | High | Test thoroughly on all 8 platforms |

### Phase 1 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Composite action breaks workflow | Low | High | Feature flag + legacy fallback |
| Action not reusable enough | Medium | Low | Don't over-abstract, keep simple |
| Maintenance burden increases | High | Medium | Document thoroughly, keep simple |

---

## Final Recommendation

### Immediate Action Plan

**This Week**:
1. ✅ **Fix cache key** (add NODE_VERSION) - 1 hour
2. ✅ **Add version validation** - 1 hour
3. ✅ **Add rollback feature flag** - 2 hours
4. ✅ **Test on all platforms** - 3 hours
5. ✅ **Update documentation** - 2 hours

**Total: 9 hours**

**Next Week**:
- **Evaluate success** of Phase 0 fixes
- **Make decision** on Phase 1 (Ninja composite action)
- **Default stance**: Stop here unless clear need for abstraction

### Philosophy

> "The best code is no code. The second best code is simple code."

The caching implementation already delivers 95%+ of the value. Further abstraction should be **justified by clear need**, not pursued for elegance alone.

**Stop after Phase 0** unless there's a concrete reason to continue.

---

## Appendix: Composite Actions vs Node.js Library

### Composite Actions (Recommended for Phase 1-2)

**Pros**:
- Simple, self-contained
- Easy to test in workflow
- Native caching support
- Easy rollback

**Cons**:
- GitHub Actions only
- Less testable than pure Node.js

**Use When**:
- Only need toolchain in CI/CD
- Want simplicity over reusability

### Node.js Library (Consider for Phase 3+)

**Pros**:
- Reusable across projects
- Testable in isolation
- Can use in local builds

**Cons**:
- Higher complexity
- Harder to test in workflows
- More maintenance burden

**Use When**:
- 3+ workflows need toolchain
- Local developers need toolchain setup
- Cross-project sharing is priority

---

## Next Steps

1. **Review this revised plan** with team
2. **Get approval** for Phase 0 critical fixes
3. **Schedule Phase 0 work** (9-11 hours this week)
4. **Defer decision** on Phase 1 until Phase 0 complete
5. **Default to stopping** after Phase 0 unless clear justification

**Key Insight**: Caching alone delivers 95%+ value. Toolchain abstraction is nice-to-have, not must-have.
