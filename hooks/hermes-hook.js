#!/usr/bin/env node
// Clawd Desktop Pet — Hermes shell hook script
// Registered in ~/.hermes/config.yaml by hooks/hermes-install.js.

const { postStateToRunningServer, readHostPrefix } = require("./server-config");
const { createPidResolver, readStdinJson, getPlatformConfig } = require("./shared-process");
const { processNames: hermesProcessNames } = require("../agents/hermes");

const HOOK_MAP = {
  on_session_start: { state: "idle", event: "SessionStart" },
  on_session_end: { state: "sleeping", event: "SessionEnd" },
  pre_llm_call: { state: "thinking", event: "UserPromptSubmit" },
  post_llm_call: { state: "attention", event: "Stop" },
  pre_tool_call: { state: "working", event: "PreToolUse" },
  post_tool_call: { state: "working", event: "PostToolUse" },
};

function stdoutForEvent() {
  return "{}";
}

function readSessionTitle(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload.session_title,
    payload.sessionTitle,
    payload.title,
    payload.extra && payload.extra.session_title,
    payload.extra && payload.extra.sessionTitle,
    payload.extra && payload.extra.title,
    payload.extra && payload.extra.session_name,
    payload.extra && payload.extra.sessionName,
  ];
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function readToolName(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.tool_name === "string" && payload.tool_name) return payload.tool_name;
  if (typeof payload.toolName === "string" && payload.toolName) return payload.toolName;
  if (typeof payload.tool === "string" && payload.tool) return payload.tool;
  return "";
}

function buildStateBody(event, payload, resolve) {
  const mapped = HOOK_MAP[event];
  if (!mapped) return null;
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const rawSessionId = safePayload.session_id != null && safePayload.session_id !== ""
    ? String(safePayload.session_id)
    : "default";
  const sessionId = rawSessionId.startsWith("hermes:") ? rawSessionId : `hermes:${rawSessionId}`;
  const cwd = typeof safePayload.cwd === "string" ? safePayload.cwd : "";
  const toolName = readToolName(safePayload);
  const sessionTitle = readSessionTitle(safePayload);

  const body = {
    state: mapped.state,
    session_id: sessionId,
    event: mapped.event,
    agent_id: "hermes",
  };
  if (cwd) body.cwd = cwd;
  if (toolName) body.tool_name = toolName;
  if (sessionTitle) body.session_title = sessionTitle;

  if (process.env.CLAWD_REMOTE) {
    body.host = readHostPrefix();
  } else {
    const { stablePid, agentPid, detectedEditor, pidChain } = resolve();
    body.source_pid = stablePid;
    if (detectedEditor) body.editor = detectedEditor;
    if (agentPid) {
      body.agent_pid = agentPid;
      body.hermes_pid = agentPid;
    }
    if (pidChain.length) body.pid_chain = pidChain;
  }

  return body;
}

function main() {
  const eventFromArgv = process.argv[2];
  const config = getPlatformConfig();
  const resolve = createPidResolver({
    agentNames: {
      win: new Set(hermesProcessNames.win || []),
      mac: new Set(hermesProcessNames.mac || []),
      linux: new Set(hermesProcessNames.linux || []),
    },
    agentCmdlineCheck: (cmd) => cmd.includes("hermes"),
    platformConfig: config,
  });

  readStdinJson().then((payload) => {
    const event = eventFromArgv || (payload && (payload.hook_event_name || payload.event)) || "";
    const outLine = stdoutForEvent(event);
    const body = buildStateBody(event, payload || {}, resolve);
    if (!body) {
      process.stdout.write(`${outLine}\n`);
      process.exit(0);
      return;
    }

    if (event === "on_session_start" && !process.env.CLAWD_REMOTE) resolve();
    postStateToRunningServer(JSON.stringify(body), { timeoutMs: 100 }, () => {
      process.stdout.write(`${outLine}\n`);
      process.exit(0);
    });
  }).catch(() => {
    process.stdout.write(`${stdoutForEvent("")}\n`);
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = {
  HOOK_MAP,
  buildStateBody,
  readSessionTitle,
  readToolName,
  stdoutForEvent,
};
