# quality-scan Reference Documentation

## Agent Prompts

### Critical Scan Agent

**Mission**: Identify critical bugs that could cause crashes, data corruption, or security vulnerabilities.

**Scan Targets**: All `.mts` files in `src/`

**Prompt Template:**
```
Your task is to perform a critical bug scan on a multi-ecosystem SBOM generator codebase written in TypeScript (.mts files). Identify bugs that could cause crashes, data corruption, or security vulnerabilities.

<context>
This is a production SBOM (Software Bill of Materials) generator supporting 19 package ecosystems (npm, Maven, Gradle, PyPI, Cargo, etc.). The codebase:
- Uses TypeScript with .mts extension
- Processes untrusted input (lockfiles, package manifests)
- Runs in production environments
- Must handle edge cases gracefully without crashes
</context>

<instructions>
Scan all TypeScript files in src/**/*.mts for these critical bug patterns:

<pattern name="null_undefined_access">
- Property access without optional chaining when value might be null/undefined
- Array access without length validation (arr[0], arr[arr.length-1])
- JSON.parse() without try-catch
- Object destructuring without null checks
</pattern>

<pattern name="unhandled_promises">
- Async function calls without await or .catch()
- Promise.then() chains without .catch() handlers
- Fire-and-forget promises that could reject
- Missing error handling in async/await blocks
</pattern>

<pattern name="race_conditions">
- Concurrent file system operations without coordination
- Parallel cache reads/writes without synchronization
- Check-then-act patterns without atomic operations
- Shared state modifications in Promise.all()
</pattern>

<pattern name="type_coercion">
- Equality comparisons using == instead of ===
- Implicit type conversions that could fail silently
- Truthy/falsy checks where explicit null/undefined checks needed
- typeof checks that miss edge cases (typeof null === 'object')
</pattern>

<pattern name="resource_leaks">
- File handles opened but not closed (missing .close() or using())
- Timers created but not cleared (setTimeout/setInterval)
- Event listeners added but not removed
- Memory accumulation in long-running processes
</pattern>

<pattern name="buffer_overflow">
- String slicing without bounds validation
- Array indexing beyond length
- Buffer operations without size checks
</pattern>

For each bug found, think through:
1. Can this actually crash in production?
2. What input would trigger it?
3. Is there existing safeguards I'm missing?
</instructions>

<output_format>
For each finding, report:

File: src/path/to/file.mts:lineNumber
Issue: [One-line description of the bug]
Severity: Critical
Pattern: [The problematic code snippet]
Trigger: [What input/condition causes the bug]
Fix: [Specific code change to fix it]
Impact: [What happens if this bug is triggered]

Example:
File: src/parsers/npm/index.mts:145
Issue: Unhandled promise rejection in dependency resolution
Severity: Critical
Pattern: `parseDependencies(pkg.dependencies)`
Trigger: When pkg.dependencies contains malformed data
Fix: `await parseDependencies(pkg.dependencies).catch(err => { log.error(err); return [] })`
Impact: Uncaught exception crashes entire SBOM generation process
</output_format>

<quality_guidelines>
- Only report actual bugs, not style issues or minor improvements
- Verify bugs are not already handled by surrounding code
- Prioritize bugs affecting production reliability
- Skip false positives (TypeScript type guards are sufficient in many cases)
- Focus on code paths processing external input
</quality_guidelines>

Scan systematically through src/ and report all critical bugs found. If no critical bugs are found, state that explicitly.
```

---

### Logic Scan Agent

**Mission**: Detect logical errors in parsers, algorithms, and control flow that could produce incorrect SBOM output.

**Scan Targets**: `src/parsers/**/index.mts` and `src/utils/*.mts`

**Prompt Template:**
```
Your task is to detect logic errors in parser implementations that could produce incorrect or incomplete SBOM output. Focus on algorithm correctness, edge case handling, and data validation.

<context>
This SBOM generator parses lockfiles and manifests from 19 package ecosystems:
- Each parser in src/parsers/{ecosystem}/index.mts implements detect() and parse()
- Parsers process external files with varying formats (JSON, YAML, TOML, custom)
- Output must be accurate CycloneDX/SPDX with correct package URLs (PURLs)
- Edge cases in external data are common (malformed files, missing fields, unexpected types)
- Utils in src/utils/ handle PURL generation, version comparison, and data transformation
</context>

<instructions>
Analyze src/parsers/**/*.mts and src/utils/*.mts for these logic error patterns:

<pattern name="off_by_one">
Off-by-one errors in loops and slicing:
- Loop bounds: `i <= arr.length` should be `i < arr.length`
- Slice operations: `arr.slice(0, len-1)` when full array needed
- String indexing missing first/last character
- lastIndexOf() checks that miss position 0
</pattern>

<pattern name="type_guards">
Insufficient type validation:
- `if (obj)` allows 0, "", false - use `obj != null` or explicit checks
- `if (arr.length)` crashes if arr is undefined - check existence first
- `typeof x === 'object'` true for null and arrays - use Array.isArray() or null check
- Missing validation before destructuring or property access
</pattern>

<pattern name="edge_cases">
Unhandled edge cases in string/array operations:
- `str.split('.')[0]` when delimiter might not exist
- `parseInt(str)` without NaN validation
- `lastIndexOf('@')` returns -1 if not found, === 0 is valid (e.g., '@package')
- Empty strings, empty arrays, single-element arrays
- Malformed input handling (missing try-catch, no fallback)
</pattern>

<pattern name="algorithm_correctness">
Algorithm implementation issues:
- Dependency graph resolution missing transitive dependencies
- Version comparison failing on semver edge cases (prerelease, build metadata)
- Cycle detection missing in graph traversal
- Incorrect sorting/ordering logic
- Missing deduplication when required
</pattern>

<pattern name="purl_generation">
Package URL (PURL) generation errors:
- Namespace: empty strings, special characters not encoded, null handling
- Version: missing URL encoding for special chars (+, @, /)
- Qualifiers: not sorted alphabetically as per spec
- Type: incorrect ecosystem mapping
</pattern>

<pattern name="parser_robustness">
Insufficient input validation:
- Empty files or empty JSON/YAML
- Required fields missing from parsed objects
- Unexpected data types (string instead of object, null instead of array)
- Malformed lockfiles with partial data
</pattern>

Before reporting, think through:
1. Does this logic error produce incorrect output?
2. What specific input would trigger it?
3. Is the error already handled elsewhere?
</instructions>

<output_format>
For each finding, report:

File: src/path/to/file.mts:lineNumber
Issue: [One-line description]
Severity: High | Medium
Edge Case: [Specific input that triggers the error]
Pattern: [The problematic code snippet]
Fix: [Corrected code]
Impact: [What incorrect output is produced]

Example:
File: src/parsers/pypi/index.mts:89
Issue: Off-by-one in dependency parsing loop
Severity: High
Edge Case: When last dependency in list is processed
Pattern: `for (let i = 0; i < deps.length - 1; i++)`
Fix: `for (let i = 0; i < deps.length; i++)`
Impact: Last dependency in requirements.txt is silently omitted from SBOM
</output_format>

<quality_guidelines>
- Prioritize parsers handling external data (lockfiles, package.json)
- Focus on errors affecting output correctness, not performance
- Verify logic errors aren't false alarms due to type narrowing
- Consider real-world input patterns for each ecosystem
</quality_guidelines>

Analyze systematically and report all logic errors found. If no errors are found, state that explicitly.
```

---

### Cache Scan Agent

**Mission**: Identify caching bugs that cause stale data, performance degradation, or incorrect behavior.

**Scan Targets**: `src/utils/file-cache.mts` and any caching logic

**Prompt Template:**
```
Your task is to analyze file caching implementation for correctness, concurrency safety, and performance issues. Focus on stale data bugs, race conditions, and memory leaks.

<context>
The SBOM generator uses file caching to avoid re-parsing lockfiles:
- Primary implementation: src/utils/file-cache.mts
- Cache keys are file paths
- Invalidation based on mtime (modification time) comparison
- Used in production where files can change during execution
- Must work correctly on Windows, macOS, and Linux
- Concurrent access possible in parallel parsing scenarios
</context>

<instructions>
Analyze caching implementation for these issue categories:

<pattern name="cache_invalidation">
Stale data from incorrect invalidation:
- mtime comparison: Are sub-second changes detected? File systems vary (1ms-2s granularity)
- Content hash: Is hash validation performed when mtime insufficient?
- Manual invalidation: Are all invalidation paths correct?
- TTL expiration: Is expiry logic correct (off-by-one, timezone issues)?
- Race: File modified between mtime check and read?
</pattern>

<pattern name="cache_keys">
Key generation correctness:
- Hash collisions: Is hash function sufficient? CRC32 vs SHA256?
- Path normalization: Are paths resolved to absolute canonical form?
- Platform differences: Windows backslashes vs Unix forward slashes handled?
- Symlinks: Are symbolic links resolved to real paths?
- Case sensitivity: Windows case-insensitive vs Linux case-sensitive
</pattern>

<pattern name="memory_management">
Memory leaks and limit enforcement:
- Size limits: Is maxCacheSize enforced correctly?
- LRU eviction: Does eviction logic work as designed?
- Stale references: Are entries fully released on eviction?
- Entry size validation: Is maxEntrySize checked before insertion?
- Unbounded growth: Can cache grow indefinitely in any scenario?
</pattern>

<pattern name="concurrency">
Race conditions in cache operations:
- Map access: Concurrent reads/writes to cache Map without locks?
- Check-then-act: `if (!cache.has(key))` then `cache.set(key)` - race window?
- In-flight deduplication: Multiple simultaneous requests for same uncached file?
- Invalidation during read: Entry removed while being accessed?
- Promise caching: Cached promises rejected but not removed?
</pattern>

<pattern name="stale_data">
Scenarios producing stale cached data:
- File modified but mtime unchanged (OS granularity, clock skew)
- Rapid successive writes within mtime granularity
- File replaced atomically (rename) with same mtime
- Symlink target changed but symlink mtime unchanged
- Network filesystem with delayed mtime propagation
</pattern>

<pattern name="edge_cases">
Uncommon scenarios:
- Empty files (zero bytes) - cached correctly?
- File deletion while cached - stale entry persists?
- Rapid successive reads/writes (stress testing)
- Very large files exceeding maxEntrySize
- Permission changes during caching
</pattern>

Think through each issue:
1. Can this actually happen in production?
2. What observable behavior results?
3. How likely/severe is the impact?
</instructions>

<output_format>
For each finding, report:

File: src/utils/file-cache.mts:lineNumber
Issue: [One-line description]
Severity: High | Medium
Scenario: [Step-by-step sequence showing how bug manifests]
Pattern: [The problematic code snippet]
Fix: [Specific code change]
Impact: [Observable effect - wrong output, performance, crash]

Example:
File: src/utils/file-cache.mts:67
Issue: Race condition in cache population
Severity: High
Scenario: Two parallel requests for uncached file both populate cache simultaneously
Pattern: `if (!cache.has(key)) { const data = await readFile(); cache.set(key, data); }`
Fix: Use in-flight map: `const inFlight = new Map(); if (inFlight.has(key)) return inFlight.get(key);`
Impact: Duplicate file reads, wasted resources, potential cache corruption
</output_format>

<quality_guidelines>
- Focus on correctness issues that produce wrong output or crashes
- Consider cross-platform filesystem differences (Windows, macOS, Linux)
- Evaluate concurrency scenarios realistic for parallel parsing
- Verify issues aren't prevented by existing safeguards
</quality_guidelines>

Analyze the caching implementation thoroughly and report all issues found. If the implementation is sound, state that explicitly.
```

---

### Workflow Scan Agent

**Mission**: Detect problems in build scripts, CI configuration, git hooks, and developer workflows.

**Scan Targets**: `scripts/*.mjs`, `package.json`, `.git-hooks/*`, CI configs

**Prompt Template:**
```
Your task is to identify issues in development workflows, build scripts, and CI configuration that could cause build failures, test flakiness, or poor developer experience.

<context>
This project uses:
- Build scripts: scripts/*.mjs (ESM, cross-platform Node.js)
- Package manager: pnpm with scripts in package.json
- Git hooks: .git-hooks/* for pre-commit, pre-push validation
- CI: GitHub Actions or similar (check for .github/workflows/)
- Platforms: Must work on Windows, macOS, Linux
- CLAUDE.md defines conventions (Conventional Commits, no process.exit(), etc.)
</context>

<instructions>
Analyze workflow files for these issue categories:

<pattern name="scripts_cross_platform">
Cross-platform compatibility in scripts/*.mjs:
- Path separators: Hardcoded / or \ instead of path.join() or path.resolve()
- Shell commands: Platform-specific (e.g., rm vs del, cp vs copy)
- Line endings: \n vs \r\n handling in text processing
- File paths: Case sensitivity differences (Windows vs Linux)
- Environment variables: Different syntax (%VAR% vs $VAR)
</pattern>

<pattern name="scripts_errors">
Error handling in scripts:
- process.exit() usage: CLAUDE.md forbids this - should throw errors instead
- Missing try-catch: Async operations without error handling
- Exit codes: Non-zero exit on failure for CI detection
- Error messages: Are they helpful for debugging?
- Dependency checks: Do scripts check for required tools before use?
</pattern>

<pattern name="package_json_scripts">
package.json script correctness:
- Script chaining: Use && (fail fast) not ; (continue on error) when errors matter
- Platform-specific: Commands that don't work cross-platform (grep, find, etc.)
- Convention compliance: Match patterns in CLAUDE.md (e.g., `pnpm run foo --flag` not `foo:bar`)
- Missing scripts: Standard scripts like build, test, lint documented?
</pattern>

<pattern name="git_hooks">
Git hooks configuration:
- Pre-commit: Does it run linting/formatting? Is it fast (<10s)?
- Pre-push: Does it run tests to prevent broken pushes?
- False positives: Do hooks block legitimate commits?
- Error messages: Are hook failures clearly explained?
- Hook installation: Is setup documented in README?
</pattern>

<pattern name="ci_configuration">
CI pipeline issues:
- Build order: Are steps in correct sequence (install → build → test)?
- Test coverage: Is coverage collected and reported?
- Artifact generation: Are build artifacts uploaded?
- Failure notifications: Are failures clearly visible?
- Caching: Are dependencies cached for speed?
</pattern>

<pattern name="developer_experience">
Documentation and setup:
- README: Setup instructions clear and complete?
- Common errors: Are frequent issues documented with solutions?
- Required tools: List of prerequisites (Node.js version, pnpm, etc.)?
- Environment variables: Are required env vars documented?
- First-time setup: Can a new contributor get started easily?
</pattern>

For each issue, consider:
1. Does this actually affect developers or CI?
2. How often would this be encountered?
3. Is there a simple fix?
</instructions>

<output_format>
For each finding, report:

File: [scripts/foo.mjs:line OR package.json:scripts.build OR .github/workflows/ci.yml:line]
Issue: [One-line description]
Severity: Medium | Low
Impact: [How this affects developers or CI]
Pattern: [The problematic code or configuration]
Fix: [Specific change to resolve]

Example:
File: scripts/build.mjs:23
Issue: Uses process.exit() violating CLAUDE.md convention
Severity: Medium
Impact: Cannot be tested properly, unconventional error handling
Pattern: `process.exit(1)`
Fix: `throw new Error('Build failed: ...')`

Example:
File: package.json:scripts.test
Issue: Script chaining uses semicolon instead of &&
Severity: Medium
Impact: Tests run even if build fails, masking build issues
Pattern: `"test": "pnpm build ; pnpm vitest"`
Fix: `"test": "pnpm build && pnpm vitest"`
</output_format>

<quality_guidelines>
- Focus on issues that cause actual build/test failures
- Consider cross-platform scenarios (Windows, macOS, Linux)
- Verify conventions match CLAUDE.md requirements
- Prioritize developer experience issues (confusing errors, missing docs)
</quality_guidelines>

Analyze workflow files systematically and report all issues found. If workflows are well-configured, state that explicitly.
```

---

## Scan Configuration

### Severity Levels

| Level | Description | Action Required |
|-------|-------------|-----------------|
| **Critical** | Crashes, security vulnerabilities, data corruption | Fix immediately |
| **High** | Logic errors, incorrect output, resource leaks | Fix before release |
| **Medium** | Performance issues, edge case bugs | Fix in next sprint |
| **Low** | Code smells, minor inconsistencies | Fix when convenient |

### Scan Priority Order

1. **critical** - Most important, run first
2. **logic** - Parser correctness critical for SBOM accuracy
3. **cache** - Performance and correctness
4. **workflow** - Developer experience

### Coverage Targets

- **critical**: All src/ files
- **logic**: src/parsers/ (19 ecosystems) + src/utils/
- **cache**: src/utils/file-cache.mts + related
- **workflow**: scripts/, package.json, .git-hooks/, CI

---

## Report Format

### Structured Findings

Each finding should include:
```typescript
{
  file: "src/utils/file-cache.mts:89",
  issue: "Potential race condition in cache update",
  severity: "High",
  scanType: "cache",
  pattern: "if (cached) { /* check-then-act */ }",
  suggestion: "Use atomic operations or locking",
  impact: "Could return stale data under concurrent access"
}
```

### Example Report Output

```markdown
# Quality Scan Report

**Date:** 2026-02-05
**Scans:** critical, logic, cache, workflow
**Files Scanned:** 127
**Findings:** 2 critical, 5 high, 8 medium, 3 low

## Critical Issues (Priority 1) - 2 found

### src/utils/file-cache.mts:89
- **Issue**: Potential null pointer access on cache miss
- **Pattern**: `const stats = await fs.stat(normalizedPath)`
- **Fix**: Add try-catch or check file existence first
- **Impact**: Crashes when file deleted between cache check and stat

### src/parsers/npm/index.mts:234
- **Issue**: Unhandled promise rejection
- **Pattern**: `parsePackageJson(path)` without await or .catch()
- **Fix**: Add await or .catch() handler
- **Impact**: Uncaught exception crashes process

## High Issues (Priority 2) - 5 found

### src/parsers/pypi/index.mts:512
- **Issue**: Off-by-one error in bracket depth calculation
- **Pattern**: `bracketDepth - 1` can go negative
- **Fix**: Use `Math.max(0, bracketDepth - 1)`
- **Impact**: Incorrect dependency parsing for malformed files

...

## Scan Coverage
- **Critical scan**: 127 files analyzed in src/
- **Logic scan**: 19 parsers + 15 utils analyzed
- **Cache scan**: 1 file + related code paths
- **Workflow scan**: 12 scripts + package.json + 3 hooks

## Recommendations
1. Address 2 critical issues immediately before next release
2. Review 5 high-severity logic errors in parsers
3. Schedule medium issues for next sprint
4. Low-priority items can be addressed during refactoring
```

---

## Edge Cases

### No Findings

If scan finds no issues:
```markdown
# Quality Scan Report

**Result**: ✓ No issues found

All scans completed successfully with no findings.

- Critical scan: ✓ Clean
- Logic scan: ✓ Clean
- Cache scan: ✓ Clean
- Workflow scan: ✓ Clean

**Code quality**: Excellent
```

### Scan Failures

If an agent fails or times out:
```markdown
## Scan Errors

- **critical scan**: ✗ Failed (agent timeout)
  - Retry recommended
  - Check agent prompt size

- **logic scan**: ✓ Completed
- **cache scan**: ✓ Completed
- **workflow scan**: ✓ Completed
```

### Partial Scans

User can request specific scan types:
```bash
# Only run critical and logic scans
quality-scan --types critical,logic
```

Report only includes requested scan types and notes which were skipped.
