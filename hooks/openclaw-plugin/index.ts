import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AGENT_ID = "openclaw";
const SERVER_PORTS = [23333, 23334, 23335, 23336, 23337];
const RUNTIME_CONFIG_PATH = join(homedir(), ".clawd", "runtime.json");
const POST_TIMEOUT_MS = 1000;
const AUTO_SESSION_END_DELAY_MS = 5500;

let cachedPort: number | null = null;
let lastStateKey = "";
const sessionCwd = new Map<string, string>();
const sessionTitles = new Map<string, string>();
const sessionEndTimers = new Map<string, ReturnType<typeof setTimeout>>();

function readRuntimePort(): number | null {
  try {
    const raw = JSON.parse(readFileSync(RUNTIME_CONFIG_PATH, "utf8"));
    const port = Number(raw && raw.port);
    if (Number.isInteger(port) && SERVER_PORTS.includes(port)) return port;
  } catch {}
  return null;
}

function getPortCandidates(): number[] {
  const ordered: number[] = [];
  const seen = new Set<number>();
  const add = (port: number | null | undefined) => {
    if (port && SERVER_PORTS.includes(port) && !seen.has(port)) {
      seen.add(port);
      ordered.push(port);
    }
  };
  add(cachedPort);
  if (cachedPort == null) add(readRuntimePort());
  for (const port of SERVER_PORTS) add(port);
  return ordered;
}

function resolveSessionId(event: Record<string, unknown> | undefined, ctx: Record<string, unknown> | undefined): string {
  const candidates = [
    ctx?.sessionKey,
    event?.sessionKey,
    ctx?.sessionId,
    event?.sessionId,
    ctx?.childSessionKey,
    event?.childSessionKey,
    ctx?.requesterSessionKey,
    event?.requesterSessionKey,
    event?.targetSessionKey,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "default";
}

function rememberCwd(sessionId: string, ctx: Record<string, unknown> | undefined): string {
  const cwd = typeof ctx?.workspaceDir === "string" && ctx.workspaceDir
    ? ctx.workspaceDir
    : sessionCwd.get(sessionId) || process.cwd();
  if (cwd) sessionCwd.set(sessionId, cwd);
  return cwd;
}

function titlePartFromSessionId(sessionId: string): string | null {
  const normalized = sessionId
    .replace(/\\/g, "/")
    .split(/[/:]+/)
    .filter(Boolean)
    .pop() || sessionId;
  const cleaned = normalized
    .replace(/^[#:@]+/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned === "default") return null;
  return cleaned.length > 64 ? `${cleaned.slice(0, 61)}...` : cleaned;
}

function rememberSessionTitle(sessionId: string): string {
  const titlePart = titlePartFromSessionId(sessionId);
  const title = titlePart ? `OpenClaw: ${titlePart}` : "OpenClaw";
  sessionTitles.set(sessionId, title);
  return title;
}

function cancelScheduledSessionEnd(sessionId: string): void {
  const timer = sessionEndTimers.get(sessionId);
  if (!timer) return;
  clearTimeout(timer);
  sessionEndTimers.delete(sessionId);
}

function cancelScheduledSessionEndFor(event: Record<string, unknown> | undefined, ctx: Record<string, unknown> | undefined): void {
  cancelScheduledSessionEnd(resolveSessionId(event, ctx));
}

function scheduleSessionEnd(event: Record<string, unknown> | undefined, ctx: Record<string, unknown> | undefined): void {
  const sessionId = resolveSessionId(event, ctx);
  cancelScheduledSessionEnd(sessionId);
  const timer = setTimeout(() => {
    sessionEndTimers.delete(sessionId);
    sendState("sleeping", "SessionEnd", event, ctx);
    sessionCwd.delete(sessionId);
    sessionTitles.delete(sessionId);
  }, AUTO_SESSION_END_DELAY_MS);
  sessionEndTimers.set(sessionId, timer);
}

function isFinalAssistantMessage(event: Record<string, unknown> | undefined): boolean {
  const message = event?.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  const record = message as Record<string, unknown>;
  return record.role === "assistant" && record.stopReason === "stop";
}

function postStateToClawd(body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  const candidates = getPortCandidates();

  (async () => {
    for (const port of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.headers.get("x-clawd-server") === "clawd-on-desk") {
          cachedPort = port;
          try { await res.text(); } catch {}
          return;
        }
      } catch {
        clearTimeout(timer);
      }
    }
    cachedPort = null;
  })().catch(() => {});
}

function sendState(
  state: string,
  eventName: string,
  event: Record<string, unknown> | undefined,
  ctx: Record<string, unknown> | undefined,
  extra: Record<string, unknown> = {},
): void {
  const sessionId = resolveSessionId(event, ctx);
  const cwd = rememberCwd(sessionId, ctx);
  const sessionTitle = sessionTitles.get(sessionId) || rememberSessionTitle(sessionId);
  const key = `${sessionId}|${state}|${eventName}|${extra.tool_name || ""}`;
  if (key === lastStateKey) return;
  lastStateKey = key;

  postStateToClawd({
    state,
    session_id: sessionId,
    event: eventName,
    agent_id: AGENT_ID,
    cwd,
    source_pid: process.pid,
    agent_pid: process.pid,
    openclaw_pid: process.pid,
    session_title: sessionTitle,
    ...extra,
  });
}

export default function register(api: {
  on: (hookName: string, handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown) => void;
}) {
  api.on("session_start", (event, ctx) => {
    cancelScheduledSessionEndFor(event, ctx);
    sendState("idle", "SessionStart", event, ctx);
  });

  api.on("before_prompt_build", (event, ctx) => {
    cancelScheduledSessionEndFor(event, ctx);
    sendState("thinking", "UserPromptSubmit", event, ctx);
  });

  api.on("before_tool_call", (event, ctx) => {
    cancelScheduledSessionEndFor(event, ctx);
    const toolName = typeof event?.toolName === "string" ? event.toolName : undefined;
    sendState("working", "PreToolUse", event, ctx, toolName ? { tool_name: toolName } : {});
  });

  api.on("after_tool_call", (event, ctx) => {
    cancelScheduledSessionEndFor(event, ctx);
    const toolName = typeof event?.toolName === "string" ? event.toolName : undefined;
    const failed = typeof event?.error === "string" && event.error.length > 0;
    sendState(
      failed ? "error" : "working",
      failed ? "PostToolUseFailure" : "PostToolUse",
      event,
      ctx,
      toolName ? { tool_name: toolName } : {},
    );
  });

  api.on("before_compaction", (event, ctx) => {
    sendState("sweeping", "PreCompact", event, ctx);
  });

  api.on("after_compaction", (event, ctx) => {
    sendState("attention", "PostCompact", event, ctx);
  });

  api.on("before_message_write", (event, ctx) => {
    if (!isFinalAssistantMessage(event)) return;
    sendState("attention", "Stop", event, ctx);
    scheduleSessionEnd(event, ctx);
  });

  api.on("session_end", (event, ctx) => {
    cancelScheduledSessionEndFor(event, ctx);
    sendState("sleeping", "SessionEnd", event, ctx);
    const sessionId = resolveSessionId(event, ctx);
    sessionCwd.delete(sessionId);
    sessionTitles.delete(sessionId);
  });

  api.on("subagent_spawned", (event, ctx) => {
    cancelScheduledSessionEndFor(event, ctx);
    sendState("thinking", "UserPromptSubmit", event, ctx);
  });

  api.on("subagent_ended", (event, ctx) => {
    cancelScheduledSessionEndFor(event, ctx);
    const failed = event?.outcome === "error" || event?.outcome === "timeout" || event?.outcome === "killed";
    sendState(failed ? "error" : "attention", failed ? "StopFailure" : "Stop", event, ctx);
  });
}
