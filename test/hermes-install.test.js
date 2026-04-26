"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  HERMES_HOOK_EVENTS,
  registerHermesHooks,
  stripClawdHermesHookEntries,
  extractExistingNodeBin,
} = require("../hooks/hermes-install");

const tempDirs = [];

function makeHermesConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-hermes-"));
  tempDirs.push(root);
  const hermesDir = path.join(root, ".hermes");
  fs.mkdirSync(hermesDir, { recursive: true });
  return { root, hermesDir, configPath: path.join(hermesDir, "config.yaml") };
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("Hermes hook installer", () => {
  it("adds Clawd shell hooks under hooks: while preserving existing YAML", () => {
    const { configPath } = makeHermesConfig();
    fs.writeFileSync(configPath, "model:\n  default: gpt-5.5\n", "utf8");

    const result = registerHermesHooks({
      silent: true,
      configPath,
      nodeBin: "/usr/local/bin/node",
    });

    assert.deepStrictEqual(result, { added: HERMES_HOOK_EVENTS.length, skipped: 0, updated: 0 });
    const content = read(configPath);
    assert.ok(content.includes("model:\n  default: gpt-5.5"));
    assert.ok(content.includes("hooks:"));
    for (const event of HERMES_HOOK_EVENTS) {
      assert.ok(content.includes(`  ${event}:`), `${event} should be registered`);
    }
    assert.strictEqual((content.match(/hermes-hook\.js/g) || []).length, HERMES_HOOK_EVENTS.length);
  });

  it("is idempotent after a successful install", () => {
    const { configPath } = makeHermesConfig();

    registerHermesHooks({ silent: true, configPath, nodeBin: "/usr/local/bin/node" });
    const before = read(configPath);
    const result = registerHermesHooks({ silent: true, configPath, nodeBin: "/usr/local/bin/node" });

    assert.deepStrictEqual(result, { added: 0, skipped: HERMES_HOOK_EVENTS.length, updated: 0 });
    assert.strictEqual(read(configPath), before);
    assert.strictEqual((before.match(/hermes-hook\.js/g) || []).length, HERMES_HOOK_EVENTS.length);
  });

  it("updates stale Clawd commands and preserves user hooks and later top-level keys", () => {
    const { configPath } = makeHermesConfig();
    fs.writeFileSync(configPath, [
      "model:",
      "  default: deepseek/deepseek-v4-pro",
      "hooks:",
      "  pre_tool_call:",
      "    - matcher: \"terminal\"",
      "      command: \"/user/block-rm.sh\"",
      "      timeout: 5",
      "    - command: '\"/old/node\" \"/old/path/hermes-hook.js\"'",
      "      timeout: 10",
      "  post_tool_call:",
      "    - command: '\"/old/node\" \"/old/path/hermes-hook.js\"'",
      "      timeout: 10",
      "display:",
      "  compact: false",
      "",
    ].join("\n"), "utf8");

    const result = registerHermesHooks({
      silent: true,
      configPath,
      nodeBin: "/opt/homebrew/bin/node",
    });

    assert.deepStrictEqual(result, { added: 0, skipped: 0, updated: 1 });
    const content = read(configPath);
    assert.ok(content.includes("command: \"/user/block-rm.sh\""));
    assert.ok(content.includes("display:\n  compact: false"));
    assert.ok(!content.includes("/old/path/hermes-hook.js"));
    assert.ok(content.includes("/opt/homebrew/bin/node"));
    assert.strictEqual((content.match(/hermes-hook\.js/g) || []).length, HERMES_HOOK_EVENTS.length);
  });

  it("removes only Clawd-owned list items from a hooks block", () => {
    const input = [
      "hooks:",
      "  pre_tool_call:",
      "    - command: '\"node\" \"/opt/clawd/hooks/hermes-hook.js\"'",
      "      timeout: 10",
      "    - matcher: \"terminal\"",
      "      command: \"/user/hook.sh\"",
      "display:",
      "  compact: true",
      "",
    ].join("\n");

    const stripped = stripClawdHermesHookEntries(input);

    assert.strictEqual(stripped.removed, 1);
    assert.ok(!stripped.content.includes("hermes-hook.js"));
    assert.ok(stripped.content.includes("command: \"/user/hook.sh\""));
    assert.ok(stripped.content.includes("display:\n  compact: true"));
  });

  it("preserves an existing absolute node path when detection fails", () => {
    const { configPath } = makeHermesConfig();
    fs.writeFileSync(configPath, [
      "hooks:",
      "  pre_llm_call:",
      "    - command: '\"/home/user/.nvm/versions/node/v22/bin/node\" \"/old/path/hermes-hook.js\"'",
      "      timeout: 10",
      "",
    ].join("\n"), "utf8");

    assert.strictEqual(
      extractExistingNodeBin(read(configPath)),
      "/home/user/.nvm/versions/node/v22/bin/node"
    );

    registerHermesHooks({ silent: true, configPath, nodeBin: null });
    assert.ok(read(configPath).includes("/home/user/.nvm/versions/node/v22/bin/node"));
  });

  it("skips when ~/.hermes does not exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-hermes-missing-"));
    tempDirs.push(root);
    const configPath = path.join(root, ".hermes", "config.yaml");

    const result = registerHermesHooks({ silent: true, configPath });

    assert.deepStrictEqual(result, { added: 0, skipped: 0, updated: 0 });
    assert.strictEqual(fs.existsSync(configPath), false);
  });
});
