#!/usr/bin/env node
// Install Clawd's OpenClaw plugin into ~/.openclaw/extensions/clawd-openclaw/
// and enable it in ~/.openclaw/openclaw.json. The plugin runs in-process with
// OpenClaw's Gateway and forwards lifecycle hooks to Clawd's local HTTP API.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { writeJsonAtomic, asarUnpackedPath } = require("./json-utils");

const PLUGIN_ID = "clawd-openclaw";
const PLUGIN_SOURCE_DIR_NAME = "openclaw-plugin";

function resolvePluginSourceDir(baseDir) {
  const dir = path.resolve(baseDir || __dirname, PLUGIN_SOURCE_DIR_NAME);
  return asarUnpackedPath(dir);
}

function resolveOpenClawDir(homeDir = os.homedir()) {
  return path.join(homeDir, ".openclaw");
}

function resolveInstallDir(homeDir = os.homedir()) {
  return path.join(resolveOpenClawDir(homeDir), "extensions", PLUGIN_ID);
}

function resolveConfigPath(homeDir = os.homedir(), configPath = process.env.OPENCLAW_CONFIG_PATH) {
  return configPath || path.join(resolveOpenClawDir(homeDir), "openclaw.json");
}

function readConfig(configPath) {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw new Error(`Failed to read ${configPath}: ${err.message}`);
  }
}

function installPluginFiles(sourceDir, installDir) {
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(installDir), { recursive: true });
  fs.cpSync(sourceDir, installDir, { recursive: true });
}

function ensurePluginEnabled(config) {
  let changed = false;
  if (!config.plugins || typeof config.plugins !== "object" || Array.isArray(config.plugins)) {
    config.plugins = {};
    changed = true;
  }
  if (!config.plugins.entries || typeof config.plugins.entries !== "object" || Array.isArray(config.plugins.entries)) {
    config.plugins.entries = {};
    changed = true;
  }
  const currentEntry = config.plugins.entries[PLUGIN_ID];
  if (!currentEntry || typeof currentEntry !== "object" || Array.isArray(currentEntry)) {
    config.plugins.entries[PLUGIN_ID] = { enabled: true };
    changed = true;
  } else if (currentEntry.enabled !== true) {
    currentEntry.enabled = true;
    changed = true;
  }

  if (!Array.isArray(config.plugins.allow)) {
    config.plugins.allow = [PLUGIN_ID];
    changed = true;
  } else if (!config.plugins.allow.includes(PLUGIN_ID)) {
    config.plugins.allow.push(PLUGIN_ID);
    changed = true;
  }
  if (Array.isArray(config.plugins.deny)) {
    const nextDeny = config.plugins.deny.filter((id) => id !== PLUGIN_ID);
    if (nextDeny.length !== config.plugins.deny.length) {
      config.plugins.deny = nextDeny;
      changed = true;
    }
  }
  return changed;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.silent]
 * @param {string} [options.homeDir]
 * @param {string} [options.configPath]
 * @param {string} [options.sourceDir]
 * @param {string} [options.installDir]
 * @returns {{ installed: boolean, skipped: boolean, configChanged: boolean, configPath: string, installDir: string }}
 */
function registerOpenClawPlugin(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const openClawDir = resolveOpenClawDir(homeDir);
  const configPath = resolveConfigPath(homeDir, options.configPath);
  const sourceDir = options.sourceDir || resolvePluginSourceDir();
  const installDir = options.installDir || resolveInstallDir(homeDir);

  if (!options.configPath && !options.installDir) {
    let exists = false;
    try { exists = fs.statSync(openClawDir).isDirectory(); } catch {}
    if (!exists) {
      if (!options.silent) console.log("Clawd: ~/.openclaw/ not found — skipping OpenClaw plugin registration");
      return { installed: false, skipped: true, configChanged: false, configPath, installDir };
    }
  }

  installPluginFiles(sourceDir, installDir);

  const config = readConfig(configPath);
  const configChanged = ensurePluginEnabled(config);
  if (configChanged) writeJsonAtomic(configPath, config);

  if (!options.silent) {
    console.log(`Clawd OpenClaw plugin → ${installDir}`);
    if (configChanged) console.log(`  Enabled ${PLUGIN_ID} in ${configPath}`);
    else console.log(`  Already enabled ${PLUGIN_ID} in ${configPath}`);
  }

  return { installed: true, skipped: false, configChanged, configPath, installDir };
}

module.exports = {
  PLUGIN_ID,
  registerOpenClawPlugin,
  resolveConfigPath,
  resolveInstallDir,
  resolvePluginSourceDir,
};

if (require.main === module) {
  try {
    registerOpenClawPlugin({});
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
