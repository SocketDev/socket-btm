---
name: quality-scan
description: Scans the codebase for bugs, logic errors, caching issues, and workflow problems using specialized agents. Use when preparing for release, investigating quality issues, or running pre-merge checks.
user-invocable: true
allowed-tools: Task, Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*), Read, Grep, Glob, AskUserQuestion---

# quality-scan

Perform comprehensive quality analysis across the codebase using specialized agents. Clean up junk files first, then scan and generate a prioritized report with actionable fixes.

## Scan Types

1. **critical** - Crashes, security vulnerabilities, resource leaks, data corruption
2. **logic** - Algorithm errors, edge cases, type guards, off-by-one errors
3. **cache** - Cache staleness, race conditions, invalidation bugs
4. **workflow** - Build scripts, CI issues, cross-platform compatibility
5. **workflow-optimization** - CI optimization (build-required conditions on cached builds)
6. **security** - GitHub Actions workflow security (zizmor scanner)
7. **documentation** - README accuracy, outdated docs, missing documentation
8. **patch-format** - Patch file format validation

Agent prompts for each scan type are in `reference.md`.

## Process

### Phase 1: Validate Environment

```bash
git status
```

Warn about uncommitted changes but continue (scanning is read-only).

### Phase 2: Update Dependencies

```bash
pnpm run update
```

Only update the current repository. Continue even if update fails.

### Phase 3: Install zizmor

Install zizmor for GitHub Actions security scanning, respecting the `minimumReleaseAge` from `pnpm-workspace.yaml` (default 10080 minutes = 7 days). Query GitHub releases, find the latest stable release older than the threshold, and install via pipx/uvx. Skip the security scan if no release meets the age requirement.

### Phase 4: Submodule Pristine Check

If `.gitmodules` exists, run `git submodule status` and verify all submodules are pristine:
- Prefix ` ` (space) = clean — OK
- Prefix `+` = wrong commit — fix automatically
- Prefix `-` = not initialized — fix automatically
- Prefix `U` = merge conflict — report as Critical finding

For any `+` or `-` submodules, run `git submodule update --init` to restore them to the expected commits.

### Phase 5: Repository Cleanup

Find and remove junk files (with user confirmation via AskUserQuestion):
- SCREAMING_TEXT.md files outside `.claude/` and `docs/`
- Test files in wrong locations
- Temp files (`.tmp`, `.DS_Store`, `*~`, `*.swp`, `*.bak`)
- Log files in root/package directories

### Phase 6: Structural Validation

```bash
node scripts/check-consistency.mts
```

Report errors as Critical findings. Warnings are Low findings.

### Phase 7: Determine Scan Scope

Ask user which scans to run using AskUserQuestion (multiSelect). Default: all scans.

### Phase 8: Execute Scans

For each enabled scan type, spawn a Task agent with the corresponding prompt from `reference.md`. Run sequentially in priority order: critical, logic, cache, workflow, then others.

Each agent reports findings as:
- File: path:line
- Issue, Severity, Pattern, Trigger, Fix, Impact

### Phase 9: Aggregate and Report

- Deduplicate findings across scan types
- Sort by severity: Critical > High > Medium > Low
- Generate markdown report with file:line references, suggested fixes, and coverage metrics
- Offer to save to `reports/quality-scan-YYYY-MM-DD.md`

### Phase 10: Summary

Report final metrics: dependency updates, structural validation results, cleanup stats, scan counts, and total findings by severity.
