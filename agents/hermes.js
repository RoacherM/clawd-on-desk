// Hermes agent configuration
// Hook-only integration via ~/.hermes/config.yaml shell hooks.

module.exports = {
  id: "hermes",
  name: "Hermes",
  processNames: { win: ["hermes.exe"], mac: ["hermes"], linux: ["hermes"] },
  eventSource: "hook",
  // Hermes shell hook event names are snake_case plugin lifecycle names.
  eventMap: {
    on_session_start: "idle",
    on_session_end: "sleeping",
    pre_llm_call: "thinking",
    post_llm_call: "attention",
    pre_tool_call: "working",
    post_tool_call: "working",
  },
  capabilities: {
    httpHook: true,
    permissionApproval: false,
    notificationHook: true,
    interactiveBubble: false,
    sessionEnd: true,
    subagent: false,
  },
  hookConfig: {
    configFormat: "hermes-yaml",
  },
  stdinFormat: "hermesHookJson",
  pidField: "hermes_pid",
};
