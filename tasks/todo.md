# Hermes Startup Authorization Fix

- [x] Review session/project instructions and local task state.
- [x] Investigate Hermes integration root cause for repeated startup authorization.
- [x] Write a failing regression test that captures idempotent Hermes startup behavior.
- [x] Implement the smallest fix.
- [x] Run focused tests.
- [x] Run broader relevant tests.
- [x] Review diff and document results.

## Review

Root cause: Hermes persists shell hook consent by exact `(event, command)` pair. The Hermes installer previously preferred a freshly resolved Node path over the existing Clawd hook command's Node path. Startup sync could rewrite an already-approved command from one valid Node path to another, causing Hermes to ask for hook approval again.

Fix: `hooks/hermes-install.js` now preserves the existing Clawd Node path when all configured Hermes hooks already point at the current `hermes-hook.js`. Stale hook script paths still update normally.

Verification:
- `node --test test/hermes-install.test.js` passed.
- `node --test test/server-hook-management.test.js` passed.
- `node --test test/registry.test.js test/prefs.test.js` passed.
- `node --test test/hermes-install.test.js test/server-hook-management.test.js` passed.
- `npm test` ran and failed in unrelated existing areas: `test/install.test.js`, `test/kiro-install.test.js`, `test/shared-process.test.js`, and `test/updater.test.js`.
