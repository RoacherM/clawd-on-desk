#!/usr/bin/env node
// Merge Clawd Hermes shell hooks into ~/.hermes/config.yaml.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { resolveNodeBin } = require("./server-config");
const { asarUnpackedPath } = require("./json-utils");

const MARKER = "hermes-hook.js";
const HERMES_HOOK_EVENTS = [
  "on_session_start",
  "on_session_end",
  "pre_llm_call",
  "post_llm_call",
  "pre_tool_call",
  "post_tool_call",
];

function yamlSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function splitLines(content) {
  return String(content || "").split("\n");
}

function findHooksRange(lines) {
  const start = lines.findIndex((line) => /^hooks:\s*(?:#.*)?$/.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^[A-Za-z0-9_-]+:\s*(?:.*)?$/.test(line)) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function stripClawdHermesHookEntries(content) {
  const lines = splitLines(content);
  const range = findHooksRange(lines);
  if (!range) return { content: String(content || ""), removed: 0 };

  const output = [...lines.slice(0, range.start + 1)];
  let removed = 0;
  let i = range.start + 1;

  while (i < range.end) {
    const line = lines[i];
    if (/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(line)) {
      output.push(line);
      i++;
      while (i < range.end && !/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(lines[i])) {
        if (/^    -(?:\s|$)/.test(lines[i])) {
          const itemStart = i;
          i++;
          while (
            i < range.end
            && !/^    -(?:\s|$)/.test(lines[i])
            && !/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(lines[i])
          ) {
            i++;
          }
          const item = lines.slice(itemStart, i);
          if (item.join("\n").includes(MARKER)) {
            removed++;
          } else {
            output.push(...item);
          }
          continue;
        }
        output.push(lines[i]);
        i++;
      }
      continue;
    }
    output.push(line);
    i++;
  }

  output.push(...lines.slice(range.end));
  return { content: output.join("\n"), removed };
}

function findEventRange(lines, hooksRange, event) {
  const headerRe = new RegExp(`^  ${event}:\\s*(?:#.*)?$`);
  for (let i = hooksRange.start + 1; i < hooksRange.end; i++) {
    if (!headerRe.test(lines[i])) continue;
    let end = hooksRange.end;
    for (let j = i + 1; j < hooksRange.end; j++) {
      if (/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(lines[j])) {
        end = j;
        break;
      }
    }
    return { start: i, end };
  }
  return null;
}

function buildHookEntry(command) {
  return [
    `    - command: ${yamlSingleQuote(command)}`,
    "      timeout: 10",
  ];
}

function ensureHermesHookEntries(content, command) {
  let lines = String(content || "") ? splitLines(content) : [];
  let range = findHooksRange(lines);
  if (!range) {
    if (lines.length && lines[lines.length - 1].trim()) lines.push("");
    lines.push("hooks:");
    range = { start: lines.length - 1, end: lines.length };
  }

  for (const event of HERMES_HOOK_EVENTS) {
    range = findHooksRange(lines);
    const eventRange = findEventRange(lines, range, event);
    if (eventRange) {
      lines.splice(eventRange.end, 0, ...buildHookEntry(command));
    } else {
      lines.splice(range.end, 0, `  ${event}:`, ...buildHookEntry(command));
    }
  }

  return lines.join("\n");
}

function countMarkerCommands(content) {
  return (String(content || "").match(new RegExp(MARKER.replace(/\./g, "\\."), "g")) || []).length;
}

function hasDesiredHooks(content, command) {
  const lines = splitLines(content);
  const range = findHooksRange(lines);
  if (!range) return false;
  for (const event of HERMES_HOOK_EVENTS) {
    const eventRange = findEventRange(lines, range, event);
    if (!eventRange) return false;
    const block = lines.slice(eventRange.start, eventRange.end).join("\n");
    if (!block.includes(MARKER) || !block.includes(command)) return false;
  }
  return countMarkerCommands(content) === HERMES_HOOK_EVENTS.length;
}

function hasCurrentHookScript(content, hookScript) {
  const lines = splitLines(content);
  const range = findHooksRange(lines);
  if (!range) return false;
  for (const event of HERMES_HOOK_EVENTS) {
    const eventRange = findEventRange(lines, range, event);
    if (!eventRange) return false;
    const block = lines.slice(eventRange.start, eventRange.end).join("\n");
    if (!block.includes(MARKER) || !block.includes(hookScript)) return false;
  }
  return countMarkerCommands(content) === HERMES_HOOK_EVENTS.length;
}

function extractExistingNodeBin(content) {
  const raw = String(content || "");
  const commandLineRe = /^\s*(?:-\s*)?command\s*:\s*(.+)$/gm;
  let lineMatch;
  while ((lineMatch = commandLineRe.exec(raw)) !== null) {
    const value = lineMatch[1] || "";
    if (!value.includes(MARKER)) continue;
    const tokenRe = /"([^"]+)"/g;
    let tokenMatch;
    while ((tokenMatch = tokenRe.exec(value)) !== null) {
      const token = tokenMatch[1];
      if (!token || token.includes(MARKER)) continue;
      if (path.isAbsolute(token) || /^[A-Za-z]:[\\/]/.test(token) || token.startsWith("\\\\")) return token;
    }
  }
  return null;
}

function writeTextAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(tmpPath, content, "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

/**
 * Register Clawd hooks into ~/.hermes/config.yaml.
 * @param {object} [options]
 * @param {boolean} [options.silent]
 * @param {string} [options.configPath]
 * @returns {{ added: number, skipped: number, updated: number }}
 */
function registerHermesHooks(options = {}) {
  const configPath = options.configPath || path.join(os.homedir(), ".hermes", "config.yaml");
  const hermesDir = path.dirname(configPath);
  if (!fs.existsSync(hermesDir)) {
    if (!options.silent) console.log("Clawd: ~/.hermes/ not found — skipping Hermes hook registration");
    return { added: 0, skipped: 0, updated: 0 };
  }

  let content = "";
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`Failed to read config.yaml: ${err.message}`);
  }

  const hookScript = asarUnpackedPath(path.resolve(__dirname, "hermes-hook.js").replace(/\\/g, "/"));
  const resolved = options.nodeBin !== undefined ? options.nodeBin : resolveNodeBin();
  const existingNodeBin = extractExistingNodeBin(content);
  const nodeBin = existingNodeBin && hasCurrentHookScript(content, hookScript)
    ? existingNodeBin
    : resolved || existingNodeBin || "node";
  const desiredCommand = `"${nodeBin}" "${hookScript}"`;

  if (hasDesiredHooks(content, desiredCommand)) {
    if (!options.silent) {
      console.log(`Clawd Hermes hooks → ${configPath}`);
      console.log("  Skipped: already registered");
    }
    return { added: 0, skipped: HERMES_HOOK_EVENTS.length, updated: 0 };
  }

  const markerCount = countMarkerCommands(content);
  const stripped = stripClawdHermesHookEntries(content);
  const nextContent = ensureHermesHookEntries(stripped.content.trimEnd(), desiredCommand) + "\n";
  const updated = markerCount > 0 || stripped.removed > 0 ? 1 : 0;
  const added = updated ? 0 : HERMES_HOOK_EVENTS.length;
  writeTextAtomic(configPath, nextContent);

  if (!options.silent) {
    console.log(`Clawd Hermes hooks → ${configPath}`);
    console.log(`  Added: ${added}, updated: ${updated}, skipped: 0`);
  }

  return { added, skipped: 0, updated };
}

module.exports = {
  HERMES_HOOK_EVENTS,
  registerHermesHooks,
  stripClawdHermesHookEntries,
  extractExistingNodeBin,
};

if (require.main === module) {
  try {
    registerHermesHooks({});
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
