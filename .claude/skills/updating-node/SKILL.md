---
name: updating-node
description: Updates Node.js submodule to latest stable, syncs .node-version, regenerates patches. Triggers when user mentions "update Node", "new Node version", or security patches.
user-invocable: true
allowed-tools: Task, Bash, Read, Edit, Skill
---

# updating-node

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
- Applies 15 patches to Node.js source during build
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
- `.github/cache-versions.json` - Cache version keys for CI invalidation

**Post-Update Triggers:**
After updating Node.js, these skills are triggered:
- `updating-binsuite` - Updates LIEF (reads version from node/deps/LIEF) and stubs
- `updating-fast-webstreams` - Updates fast-webstreams vendor if needed

**Cache Version Bump:**
When Node.js is updated, bump the `node-smol` cache version in `.github/cache-versions.json`.

**Success Metrics:**

- Build: Must complete without errors
- Tests: 100% pass rate
- Patches: All 15 must apply cleanly
- Version consistency: `.node-version` matches submodule tag
- Cache version bumped: node-smol
  </context>

<constraints>
**Requirements:**
- Start with clean working directory (no uncommitted changes)
- Target stable tags only (v*.*.*, exclude -rc/-alpha/-beta)
- Regenerate all patches after submodule update
- Validate patches apply cleanly (always, even in CI)
- Bump cache version: node-smol
- Create two commits: version update + patch regeneration

**CI Mode** (detected via `CI=true` or `GITHUB_ACTIONS`):
- Skip build/test validation (CI validates separately)
- Skip post-update skills (parent skill coordinates)
- Workflow handles push

**Interactive Mode** (default):
- Validate build and tests pass
- Trigger post-update skills: updating-binsuite, updating-fast-webstreams

**Actions:**
- Update to latest stable Node.js tag
- Regenerate patches for new version
- Create conventional commits with detailed changelog
- Report version change and metrics
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
  subagent_type: 'general-purpose',
  description: 'Sync Node.js to latest version',
  prompt: `${NODE_SYNC_AGENT_PROMPT_FROM_REFERENCE_MD}`,
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
- Cache version bumped: node-smol
- Commits: 2
- Build: SUCCESS
- Tests: PASS
- Ready for post-update skills
  </validation>

---

### Phase 3: Trigger Post-Update Skills (Skip in CI Mode)

<action>
After Node.js update commits are created, trigger the post-update skills (skip in CI mode):
</action>

**CI Mode Skip:** In CI mode, the parent `updating` skill handles coordination of all updates. Skip this phase to avoid re-running skills that have already been executed.

```bash
# Detect CI mode
if [ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ]; then
  echo "CI mode: Skipping post-update skills (parent skill handles coordination)"
else
  # Interactive mode: trigger post-update skills
fi
```

**Interactive Mode Only:**

1. **Trigger updating-binsuite** - Updates LIEF (reads version from node/deps/LIEF) and stubs:
   ```
   Skill({ skill: "updating-binsuite" })
   ```

2. **Trigger updating-fast-webstreams** - Updates fast-webstreams vendor:
   ```
   Skill({ skill: "updating-fast-webstreams" })
   ```

Wait for both skills to complete before final summary (interactive mode only).

---

### Phase 4: Complete

<completion_signal>

```xml
<promise>SKILL_COMPLETE</promise>
```

</completion_signal>

<summary>
Report final results to the user:

# **Node.js Update Skill Complete**

✓ Autonomous agent spawned
✓ Agent completed Node.js synchronization workflow
✓ Node.js updated to latest stable version
✓ .node-version synchronized with submodule
✓ All patches regenerated and validated
✓ Build and tests passed
✓ Cache version bumped: node-smol
✓ Two commits created
✓ Post-update skills triggered: updating-binsuite, updating-fast-webstreams

**Version Change:**
OLD_VERSION → NEW_VERSION

**Node.js Commits:**

1. chore(node): update Node.js version
2. chore(node-smol-builder): rebuild with patches

**Post-Update Results:**
- updating-binsuite: [Results]
- updating-fast-webstreams: [Results]

**Next Steps:**

1. Review changes: \`git log --oneline -N\`
2. Test manually if desired
3. Push to remote: \`git push origin main\`
4. Monitor CI/CD for integration tests

Node.js is now updated to the latest stable release.

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
- ✅ Cache version bumped: node-smol
- ✅ Two commits created with detailed messages
- ✅ Post-update skills triggered: updating-binsuite, updating-fast-webstreams
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

**Post-Update Considerations:**
- **external-tools.json**: Check if `packages/node-smol-builder/scripts/*/shared/external-tools.json` need updates
- **Pinned dependencies**: All dependencies (dev and direct) are pinned to exact versions. After updating, run `pnpm run update` to check for compatible dependency updates.
- **.node-version**: Automatically updated by this skill to match the Node.js submodule version.
