"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildStateBody,
  HOOK_MAP,
  stdoutForEvent,
} = require("../hooks/hermes-hook");

function fakeResolve() {
  return {
    stablePid: 111,
    agentPid: 222,
    detectedEditor: "cursor",
    pidChain: [333, 222, 111],
  };
}

describe("Hermes hook script", () => {
  it("maps pre_llm_call to a Hermes thinking session", () => {
    const body = buildStateBody("pre_llm_call", {
      session_id: "sess-1",
      cwd: "/tmp/project",
      extra: { title: "Implement Hermes" },
    }, fakeResolve);

    assert.strictEqual(body.state, "thinking");
    assert.strictEqual(body.event, "UserPromptSubmit");
    assert.strictEqual(body.agent_id, "hermes");
    assert.strictEqual(body.session_id, "hermes:sess-1");
    assert.strictEqual(body.cwd, "/tmp/project");
    assert.strictEqual(body.session_title, "Implement Hermes");
  });

  it("passes compact tool metadata and agent pid for tool calls", () => {
    const body = buildStateBody("pre_tool_call", {
      session_id: "hermes:sess-2",
      tool_name: "terminal",
      tool_input: { command: "echo hello" },
    }, fakeResolve);

    assert.strictEqual(body.state, "working");
    assert.strictEqual(body.event, "PreToolUse");
    assert.strictEqual(body.session_id, "hermes:sess-2");
    assert.strictEqual(body.tool_name, "terminal");
    assert.strictEqual(body.tool_input, undefined);
    assert.strictEqual(body.source_pid, 111);
    assert.strictEqual(body.agent_pid, 222);
    assert.strictEqual(body.hermes_pid, 222);
    assert.deepStrictEqual(body.pid_chain, [333, 222, 111]);
  });

  it("maps post_llm_call to turn attention and session end to sleeping", () => {
    assert.deepStrictEqual(HOOK_MAP.post_llm_call, { state: "attention", event: "Stop" });
    assert.deepStrictEqual(HOOK_MAP.on_session_end, { state: "sleeping", event: "SessionEnd" });
  });

  it("ignores unknown events", () => {
    assert.strictEqual(buildStateBody("unknown", {}, fakeResolve), null);
  });

  it("prints no-op JSON so Hermes hook return values never block or inject context", () => {
    assert.strictEqual(stdoutForEvent("pre_tool_call"), "{}");
    assert.strictEqual(stdoutForEvent("pre_llm_call"), "{}");
    assert.strictEqual(stdoutForEvent("on_session_start"), "{}");
  });
});
