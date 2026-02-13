---
name: syncing-upstream
description: Synchronizes socket-btm with upstream Node.js by updating the submodule to latest tag, updating `.node-version`, regenerating patches, validating build and tests. Use when updating to new Node.js releases, applying security patches, or maintaining upstream synchronization.
user-invocable: true
disable-model-invocation: false
allowed-tools: Task
---

# syncing-upstream

<task>
Your task is to spawn an autonomous agent that synchronizes socket-btm with upstream Node.js by updating the submodule to the latest stable tag, updating `.node-version`, regenerating patches, validating build and tests pass, and committing changes with detailed metrics.
</task>

<context>
**What is Node.js Synchronization?**
socket-btm builds custom Node.js binaries with Socket Security patches. This skill keeps the baseline Node.js version up-to-date by:
- Updating upstream Node.js submodule to latest stable tag
- Synchronizing `.node-version` to match submodule
- Regenerating Socket Security patches for new Node.js version
- Validating patches apply cleanly to new version
- Ensuring build and tests pass with updated Node.js

**socket-btm Architecture:**
This is Socket Security's binary tooling manager (BTM) that:
- Builds custom Node.js binaries with Socket Security patches
- Tracks upstream Node.js via submodule: `packages/node-smol-builder/upstream/node`
- Maintains `.node-version` for tooling and CI consistency
- Applies 13 patches to Node.js source during build
- Produces production-ready patched Node.js binaries

**When to Sync:**
- New Node.js stable release (security patches, features)
- Security advisories requiring Node.js upgrade
- Feature development requiring newer Node.js APIs
- Regular maintenance (monthly or quarterly cadence)

**Critical Files:**
- `.node-version` - Node.js version for tooling (nvm, volta, etc.)
- `packages/node-smol-builder/upstream/node` - Git submodule tracking nodejs/node
- `packages/node-smol-builder/patches/source-patched/*.patch` - Socket Security patches

**Success Metrics:**
- Build: Must complete without errors
- Tests: 100% pass rate
- Patches: All 13 must apply cleanly
- Version consistency: `.node-version` matches submodule tag
</context>

<constraints>
**CRITICAL Requirements:**
- Working directory MUST be clean before starting (no uncommitted changes)
- Submodule MUST update to stable tag only (no release candidates)
- All patches MUST apply cleanly to new Node.js version
- Build MUST succeed without errors
- Tests MUST pass (100% success rate)
- Two commits MUST be created (version update + patch regeneration)

**Do NOT:**
- Update to release candidate or nightly tags (unstable)
- Skip patch regeneration after Node.js update (will break build)
- Skip build validation (untested changes risky for production)
- Skip test validation (functional regressions undetected)
- Commit without validating patches apply cleanly

**Do ONLY:**
- Update to latest stable tag (format: v*.*.*, no -rc suffix)
- Regenerate patches after submodule update
- Validate build and tests before final commit
- Create two atomic commits (version + patches)
- Use conventional commit format with detailed changelog
- Report version change and commit metrics
</constraints>

<instructions>

## Process

This skill spawns an autonomous agent to handle the complete Node.js synchronization workflow, including version update, patch regeneration, validation, and commits.

### Phase 1: Validate Environment

<prerequisites>
Before spawning the agent, verify the environment is ready:
</prerequisites>

<action>
Check working directory and submodule state:
</action>

```bash
# Check working directory is clean
git status

# Verify upstream submodule exists
ls -la packages/node-smol-builder/upstream/node

# Check current Node.js version
cat .node-version
```

<validation>
**Expected State:**
- ✓ Working directory clean (no uncommitted changes)
- ✓ Submodule directory exists: `packages/node-smol-builder/upstream/node/`
- ✓ `.node-version` file exists with valid version

**If working directory NOT clean:**
- Commit or stash changes before proceeding
- Node.js sync should start from clean state

**If submodule missing:**
- Initialize: `git submodule update --init --recursive`
- Report error and ask user to fix

Do NOT proceed if environment checks fail.
</validation>

---

### Phase 2: Spawn Autonomous Agent

<action>
Load the agent prompt template from reference.md and spawn the autonomous agent:
</action>

**Agent Prompt Source:** The complete agent prompt template is documented in `reference.md` under the "Agent Prompt Template" section. This prompt contains detailed instructions for the 8-step Node.js synchronization workflow.

**Spawn Agent:**

```javascript
Task({
  subagent_type: "general-purpose",
  description: "Sync Node.js to latest version",
  prompt: `${NODE_SYNC_AGENT_PROMPT_FROM_REFERENCE_MD}`
})
```

**Instructions for Skill Executor:**

1. **Read the agent prompt template** from `reference.md` starting at the "Agent Prompt Template" heading
2. **Extract the full prompt** (from "Synchronize socket-btm..." through the final rollback bash block)
3. **Pass the prompt to Task tool** using the code block above (replace placeholder with actual prompt content)
4. **Monitor agent execution** and capture the output
5. **Verify completion signal**: Agent must output `<promise>NODE_SYNC_COMPLETE</promise>`

**Why Extracted to reference.md:**
- Keeps SKILL.md concise and focused on skill logic
- Agent prompt template is 484 lines - too large to embed inline
- reference.md provides single source of truth for the prompt
- Easier to maintain, update, and review prompt independently
- Follows same pattern as quality-scan skill

<validation>
**Structured Output Validation:**

After agent returns, validate output structure before parsing:

```bash
# 1. Verify completion signal
if ! echo "$AGENT_OUTPUT" | grep -q '<promise>NODE_SYNC_COMPLETE</promise>'; then
  echo "ERROR: Agent did not complete successfully"
  echo "Agent may have failed or encountered an error"
  echo "Review agent output for error messages"
  exit 1
fi

# 2. Verify expected content sections exist
VALIDATION_FAILED=0

if ! echo "$AGENT_OUTPUT" | grep -q 'Node.js Synchronization Complete'; then
  echo "WARNING: Missing summary report section"
  VALIDATION_FAILED=1
fi

if ! echo "$AGENT_OUTPUT" | grep -q 'Updated from:.*→'; then
  echo "WARNING: Missing version change information"
  VALIDATION_FAILED=1
fi

if ! echo "$AGENT_OUTPUT" | grep -q 'Commits Created:'; then
  echo "WARNING: Missing commit information"
  VALIDATION_FAILED=1
fi

if [ $VALIDATION_FAILED -eq 1 ]; then
  echo "WARNING: Agent output structure incomplete"
  echo "Proceeding with manual verification..."
fi
```

**Manual Verification Checklist:**
- [ ] Agent output shows `<promise>NODE_SYNC_COMPLETE</promise>`
- [ ] Two commits created (check: `git log -2 --oneline`)
- [ ] .node-version matches submodule tag
- [ ] Build and tests passed (check agent output for "✓ Build and tests passed")
- [ ] No error messages in agent output

**If validation fails:**
- Review full agent output for specific errors
- Check git status and commits created
- Rollback if needed: `git reset --hard HEAD~2`

**Report to user:**
- Node.js updated: vOLD → vNEW
- Commits: 2
- Build: SUCCESS
- Tests: PASS
- Ready for push
</validation>

---

### Phase 3: Complete

<completion_signal>
```xml
<promise>SKILL_COMPLETE</promise>
```
</completion_signal>

<summary>
Report final results to the user:

**Node.js Synchronization Skill Complete**
=========================================
✓ Autonomous agent spawned
✓ Agent completed Node.js synchronization workflow
✓ Node.js updated to latest stable version
✓ .node-version synchronized with submodule
✓ All patches regenerated and validated
✓ Build and tests passed
✓ Two commits created

**Version Change:**
OLD_VERSION → NEW_VERSION

**Commits:**
1. chore(node): update Node.js version
2. chore(node-smol-builder): rebuild with patches

**Next Steps:**
1. Review changes: \`git log -2 --stat\`
2. Test manually if desired
3. Push to remote: \`git push origin main\`
4. Monitor CI/CD for integration tests

Node.js is now synchronized to the latest stable release.
</summary>

</instructions>

## Success Criteria

- ✅ \`<promise>SKILL_COMPLETE</promise>\` output
- ✅ Autonomous agent spawned with detailed instructions
- ✅ Agent completed Node.js synchronization workflow
- ✅ .node-version updated to latest stable
- ✅ Submodule updated to latest stable tag
- ✅ All patches regenerated and applied cleanly
- ✅ Build and tests passed (100%)
- ✅ Two commits created with detailed messages
- ✅ Ready for push to remote

## Commands

This skill spawns an autonomous agent. No direct commands needed.

## Context

This skill is useful for:
- Updating to new Node.js stable releases
- Applying security patches from upstream
- Accessing new Node.js APIs and features
- Maintaining compatibility with ecosystem tools
- Regular maintenance (monthly or quarterly)

**Safety:** Working directory must be clean. Validation ensures patches apply and tests pass before committing. Rollback available with \`git reset --hard HEAD~2\`.

**Trade-offs:**
- ✓ Automated workflow (minimal manual steps)
- ✓ Validation ensures patches work with new version
- ✓ Atomic commits (version + patches separate)
- ✓ Retry logic for flaky operations
- ✗ Requires clean working directory
- ✗ May fail if patches incompatible with new Node.js
- ✗ Manual intervention needed if validation fails
