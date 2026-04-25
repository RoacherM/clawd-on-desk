const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { registerOpenClawPlugin } = require("../hooks/openclaw-install");

const tempDirs = [];

function makeTempHome() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-openclaw-install-"));
  tempDirs.push(tmpDir);
  fs.mkdirSync(path.join(tmpDir, ".openclaw"), { recursive: true });
  return tmpDir;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("OpenClaw plugin installer", () => {
  it("installs the plugin under ~/.openclaw/extensions and enables it in config", () => {
    const homeDir = makeTempHome();

    const result = registerOpenClawPlugin({ silent: true, homeDir });

    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.installed, true);
    assert.strictEqual(result.configChanged, true);
    assert.strictEqual(
      result.installDir,
      path.join(homeDir, ".openclaw", "extensions", "clawd-openclaw")
    );
    assert.ok(fs.existsSync(path.join(result.installDir, "index.ts")));
    assert.ok(fs.existsSync(path.join(result.installDir, "openclaw.plugin.json")));

    const config = readJson(path.join(homeDir, ".openclaw", "openclaw.json"));
    assert.strictEqual(config.plugins.entries["clawd-openclaw"].enabled, true);
    assert.deepStrictEqual(config.plugins.allow, ["clawd-openclaw"]);
  });

  it("adds the plugin id to an existing allowlist without clobbering entries", () => {
    const homeDir = makeTempHome();
    const configPath = path.join(homeDir, ".openclaw", "openclaw.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ plugins: { allow: ["voice-call"], entries: { "voice-call": { enabled: true } } } }, null, 2),
      "utf8"
    );

    registerOpenClawPlugin({ silent: true, homeDir });

    const config = readJson(configPath);
    assert.deepStrictEqual(config.plugins.allow, ["voice-call", "clawd-openclaw"]);
    assert.strictEqual(config.plugins.entries["voice-call"].enabled, true);
    assert.strictEqual(config.plugins.entries["clawd-openclaw"].enabled, true);
  });

  it("is idempotent when run repeatedly", () => {
    const homeDir = makeTempHome();

    registerOpenClawPlugin({ silent: true, homeDir });
    const second = registerOpenClawPlugin({ silent: true, homeDir });

    assert.strictEqual(second.configChanged, false);
    const config = readJson(path.join(homeDir, ".openclaw", "openclaw.json"));
    assert.deepStrictEqual(config.plugins.allow, ["clawd-openclaw"]);
    assert.strictEqual(config.plugins.entries["clawd-openclaw"].enabled, true);
  });

  it("skips when ~/.openclaw does not exist", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-openclaw-missing-"));
    tempDirs.push(homeDir);

    const result = registerOpenClawPlugin({ silent: true, homeDir });

    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.installed, false);
    assert.strictEqual(fs.existsSync(path.join(homeDir, ".openclaw")), false);
  });
});
