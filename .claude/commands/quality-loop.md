Run the quality-scan skill and fix all issues found. Repeat until zero issues remain or 5 iterations complete.

## Process

1. Run quality-scan skill
2. If issues found: fix them all
3. Run quality-scan again
4. Repeat until zero issues or 5 iterations
5. Commit fixes:
   - If repo has only 1 commit: amend that commit
   - Otherwise: new commit "fix: resolve quality scan issues (iteration N)"
6. Run tests after fixes to verify nothing broke
