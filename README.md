# dsh-reveal-in-folder

[中文说明](README.zh.md)

A [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) plugin that puts a **folder icon** after every file a
turn produced. Click it and the OS file manager opens with that file's containing
folder — the file selected on Windows and macOS, the folder opened on Linux/WSL.

At the tail of each assistant turn you get one row:

```
Files from this turn   report.md 📂   model.py 📂   chart.png 📂
```

Each chip's name opens the file in the Harness right pane (the host's own
`openFile` action); the 📂 icon reveals it in the system file manager.

## Why a plugin?

Harness already knows how to reveal a file: the official deliverables card exposes
`open` / `reveal` — but only for files the agent **presented** (`present` tool, or
the Changes review tab). Files that were simply written or edited during the turn
appear as plain changed-file rows, with no way to jump to the folder.

This plugin fills exactly that gap: it lists the files the turn *produced* and puts
a reveal button on every one of them.

## How it works

- **Client-only bundle.** The host half (`lib/index.js`) is an empty `apply()` on
  purpose — see "Security" below.
- **Where the list comes from**: a Conversation `Definition`
  (`reveal-in-folder-files`) registered on `ctx.uiConversation.events` folds
  `turn/start` / `tool/call` / `tool/result` events into a per-turn file list, the
  same framework channel the official deliverables card uses. Turn membership is
  owned by the engine; the plugin never scrapes DOM of another plugin.
- **What counts as produced**: successful `write`, `edit`, mutating
  `str_replace_editor`, and `apply_patch` calls, using the absolute path the Host
  records in the tool result metadata (falling back to the argument path, resolved
  against the session workspace). Reads, failed calls, and unsupported tools
  contribute nothing.
- **Where it renders**: slot `conversation.chat.turnTail`, entry
  `dsh-reveal-in-folder.turn-tail`, `order: 5` (just after the deliverables card).
- **What the click does**: `ctx.remote.session.openWorkspacePath({ path, action:
  'reveal' })` — the one Host entry point the official UI already uses. The Host
  dispatches to Explorer `/select`, macOS `open -R`, `xdg-open`, or the WSL bridge,
  behind its own "path belongs to a verified desktop workspace" check.
- **When there is nothing to reveal**: the row renders only after
  `ctx.remote.session.canOpenWorkspacePath()` answers `true`, so a headless server
  (or a Linux host without `DISPLAY`) shows no dangling icons.
- Paths that the Host cannot verify answer with an error; the button turns red in
  place instead of failing silently.

## Install

Requires the DSH Web UI (verified on `0.2.1-rc.3`) and a Harness Host running on the
same desktop as your browser.

```sh
dsh plugin --profile web add "github:danchaw/dsh-reveal-in-folder#main"
```

…or install it from the **Plugins** page in the Web UI. Restart Harness (reload the
page) afterwards: a bundle is picked up when the composition is rebuilt.

Install from a local checkout while developing:

```sh
dsh plugin --profile web add "C:\Users\you\Documents\DSH\dsh-reveal-in-folder"
```

Remove it:

```sh
dsh plugin --profile web remove dsh-reveal-in-folder
```

## Configuration

None. The plugin adds no tool, no prompt, no setting, and no network endpoint.

## Repository layout

| Path | What it is |
| --- | --- |
| `lib/index.js` | Host half — deliberately empty; the reveal operation stays in the Host. |
| `lib/client.js` | Browser module: the event `Definition`, the turn-tail entry, the 📂 button. |
| `cordis.patch.yml` | The composition row Plugin Manager inserts on install. |
| `locale/en.json`, `locale/zh.json` | Bundle display metadata for the plugins page. |
| `icon.svg` | Bundle icon (original artwork, MIT). |
| `test/` | `node --test` suite: manifest checks plus a headless runtime smoke (a hook-backed renderer runs the event fold, the capability gate, and a click). |

## Security notes

The plugin ships **no HTTP route and spawns no process**. Revealing a folder is a
Host-side capability that already exists and is already guarded (it verifies that
the path resolves inside a desktop-verified workspace). A second plugin-local
implementation would double the attack surface for the same result, so this bundle is
UI-only and calls the official entry point.

## Development

```sh
npm test
```

No dependencies, no build step — `lib/client.js` is the plain browser module DSH
loads (`window.__ModuleLoader__`).

## Known limits

- Only files produced by `write` / `edit` / `str_replace_editor` / `apply_patch` are
  listed. A file created by a shell command shows up on the deliverables card only
  after the model `present`s it — and that card already has its own reveal button.
- At most 24 chips per turn; the rest collapse into a "{count} more files" note.

## License

MIT — see [LICENSE](LICENSE).
