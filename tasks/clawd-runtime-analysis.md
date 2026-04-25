# Clawd Runtime Analysis

This note records how Clawd on Desk works internally and where to extend it for
custom pets or non-coding agents such as OpenClaw/Hermes.

## Core Model

Clawd is a desktop state visualizer. Agent-specific integrations do not render
the pet directly. They translate native agent activity into a small Clawd state
contract and POST it to the local server:

```json
{
  "agent_id": "example-agent",
  "session_id": "session-001",
  "event": "UserPromptSubmit",
  "state": "thinking",
  "cwd": "/path/to/context",
  "source_pid": 12345,
  "display_svg": "optional-theme-token.svg"
}
```

The server accepts the event, the state machine merges it with other live
sessions, and the active theme decides which animation asset is shown.

## Runtime Flow

1. Agent emits native events.
2. Adapter layer normalizes those events:
   - command hooks for Claude Code, Cursor, CodeBuddy, Kiro, Kimi
   - log polling for Codex and Gemini
   - in-process plugin for opencode
3. Adapter POSTs normalized events to `POST /state` on `127.0.0.1:23333-23337`.
4. `src/server.js` validates the payload, applies agent gates, and forwards it
   to `updateSession`.
5. `src/state.js` stores per-session state, removes stale sessions, and resolves
   one display state by priority.
6. `theme-loader` and `state.js` resolve the display state to a concrete asset.
7. `src/renderer.js` swaps the SVG/image channel and applies eye tracking,
   transitions, low-power pause, and reactions.

Permission requests use `POST /permission` instead of plain `/state` when the
source agent can wait for a decision or expose a reverse bridge.

## State Vocabulary

The shared semantic states are intentionally small:

- `idle`: no active work
- `thinking`: prompt accepted / model deciding
- `working`: tool execution, retrieval, external action
- `juggling`: subagent or delegated work
- `attention`: task completed
- `notification`: permission request or user attention needed
- `error`: failure
- `sweeping`: compaction or context cleanup
- `carrying`: worktree / update download style activity
- `sleeping`: session ended or dormant

The state machine then applies priority:

```text
error > notification > sweeping > attention > carrying/juggling
  > working > thinking > idle > sleeping
```

One-shot states such as `attention`, `error`, `sweeping`, `notification`, and
`carrying` display briefly and auto-return.

## Pet Appearance

Pet appearance is owned by themes, not by agent adapters.

User themes live under Electron `userData`:

```text
~/Library/Application Support/clawd-on-desk/themes/<theme-id>/
  theme.json
  assets/
```

Create a scaffold:

```bash
npm run create-theme -- my-theme
```

Important `theme.json` fields:

- `states`: maps semantic states to SVG/GIF/APNG/WebP/PNG/JPG assets.
- `eyeTracking`: enables SVG eye tracking by targeting ids such as `eyes-js`.
- `workingTiers`: chooses different `working` animations by active session count.
- `jugglingTiers`: chooses different subagent animations by juggling count.
- `idleAnimations`: random idle animation pool.
- `reactions`: drag, double-click, and repeated-click reactions.
- `miniMode`: edge-hidden mini pet assets.
- `timings`: idle, sleep, min-display, auto-return, and transition timing.
- `displayHintMap`: lets integrations request theme-specific visuals without
  hard-coding asset names into the integration.

## Behavior Customization

There are two extension layers:

1. Integration mapping: native agent event to semantic state.
2. Theme mapping: semantic state to concrete visual.

For example, an agent may map "started retrieval" to `working`, while the theme
maps `working` to `typing.gif` for one session and `building.gif` for three or
more sessions. This keeps external integrations independent from pet art.

## Non-Coding Agent Integration

For OpenClaw/Hermes-style agents, the minimal adapter is any process that can
emit localhost HTTP state events.

Suggested mapping:

| Agent lifecycle | Clawd event | Clawd state |
| --- | --- | --- |
| user request received | `UserPromptSubmit` | `thinking` |
| model calls tool / retrieval / action | `PreToolUse` | `working` |
| action completed but loop continues | `PostToolUse` | `working` |
| delegated subtask starts | `SubagentStart` | `juggling` |
| delegated subtask ends | `SubagentStop` | `working` |
| waiting for user / approval | `Notification` | `notification` |
| task done | `Stop` | `attention` |
| task failed | `StopFailure` | `error` |
| session closed | `SessionEnd` | `sleeping` |

Example:

```bash
curl -sS http://127.0.0.1:23333/state \
  -H 'Content-Type: application/json' \
  -d '{
    "agent_id": "hermes",
    "session_id": "chat-001",
    "event": "PreToolUse",
    "state": "working",
    "cwd": "/Users/byron/project"
  }'
```

To make the agent appear as a first-class settings entry, add:

- `agents/<agent-id>.js` with id, display name, event source, capabilities, and
  process names.
- an entry in `agents/registry.js`.
- an icon at `assets/icons/agents/<agent-id>.png`.
- an installer only if the target agent has a persistent hook/plugin config.

Permission bubbles need more care:

- Use blocking `/permission` if the agent can wait on Clawd's HTTP response.
- Use an opencode-style reverse bridge if the agent cannot expose a blocking
  external decision flow.
- Otherwise map approval-needed states to `notification` and let the agent's
  native UI handle the final decision.

## Diagram

Open `tasks/clawd-runtime-flow.html` for a visual version of this flow.
