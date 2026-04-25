// OpenClaw agent configuration
// Perception via OpenClaw Plugin SDK lifecycle hooks → HTTP POST to Clawd.
// Plugin installed under ~/.openclaw/extensions/clawd-openclaw/.

module.exports = {
  id: "openclaw",
  name: "OpenClaw",
  processNames: { win: ["openclaw.exe"], mac: ["openclaw"], linux: ["openclaw"] },
  eventSource: "plugin-event",
  // OpenClaw's plugin translates typed lifecycle hooks into these Clawd
  // internal event names so state.js can reuse the existing transition rules.
  eventMap: {
    SessionStart: "idle",
    SessionEnd: "sleeping",
    UserPromptSubmit: "thinking",
    PreToolUse: "working",
    PostToolUse: "working",
    PostToolUseFailure: "error",
    Stop: "attention",
    StopFailure: "error",
    PreCompact: "sweeping",
    PostCompact: "attention",
  },
  capabilities: {
    httpHook: false,
    permissionApproval: false,
    sessionEnd: true,
    subagent: true,
  },
  pidField: "openclaw_pid",
};
