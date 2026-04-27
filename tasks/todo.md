# Pet Configuration Research

- [x] Map the user-facing configuration surface from README and guides.
- [x] Trace settings persistence and runtime application in `src/`.
- [x] Identify theme, animation, agent, and integration configuration files.
- [x] Summarize how to configure the pet and what to verify.

## Review

Clawd configuration is split across:

- runtime preferences in Electron `userData/clawd-prefs.json`
- user themes under Electron `userData/themes/<themeId>/theme.json`
- copied/sanitized theme assets under `theme-cache` and sound overrides under `sound-overrides`
- per-agent external hook/plugin files in each agent home config
- OS login/autostart settings for launch-on-login

No product code was changed for this research pass.

---

# Runtime Architecture Research

- [x] Trace agent event ingestion paths: hooks, log polling, and opencode plugin.
- [x] Trace `/state` and `/permission` server behavior.
- [x] Trace state machine resolution and animation selection.
- [x] Trace theme customization and user override layers.
- [x] Produce a readable flow diagram and integration notes for non-coding agents.

## Review

Clawd's core extension point is the normalized `/state` contract:
`{ state, event, session_id, agent_id, cwd?, source_pid?, display_svg? }`.
Any external agent can integrate if it can emit lifecycle events to localhost
or provide a small bridge/plugin that maps its native events into this contract.

---

# Miexiaomie Asset Import

- [x] Locate the downloaded miexiaomie folder on Desktop.
- [x] Move the folder into the repository root without modifying image contents.
- [x] Verify the imported files and working tree state.

## Review

Imported `/Users/byron/Desktop/Docs/miexiaomie_png` to repository root as
`miexiaomie_png/`. The source Desktop folder is gone after the move. The import
contains 11 PNG files, all reported as 1254 x 1254 RGB PNG images.
