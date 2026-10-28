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

Current release: [v0.1.2](https://github.com/danchaw/dsh-reveal-in-folder/releases/tag/v0.1.2)
· changes in [CHANGELOG.md](CHANGELOG.md).

## Why a plugin?

Harness already knows how to reveal a file: the official deliverables card exposes
`open` / `reveal` — but only for files the agent **presented** (`present` tool, or
the Changes review tab). Files that were simply written or edited during the turn
appear as plain changed-file rows, with no way to jump to the folder.

This plugin fills exactly that gap: it lists the files the turn *produced* and puts
a reveal button on every one of them.

## How it works

- **Client-only bundle.** The host half (`lib/index.js`) is an empty `apply()` on
  purpose — see "Security notes" below.
- **Where the list comes from**: a Conversation `Definition`
  (`reveal-in-folder-files`) registered on `ctx.uiConversation.events` folds
  `turn/start` / `tool/call` / `tool/result` events into a per-turn file list, the
  same framework channel the official deliverables card uses. Turn membership is
  owned by the engine; the plugin never scrapes the DOM of another plugin.
- **What counts as produced**: successful `write`, `edit`, mutating
  `str_replace_editor`, and `apply_patch` calls. The call's **arguments** must name a
  file path; the absolute path recorded by the Host in the tool-result metadata then
  wins over the argument path (relative paths resolve against the session
  workspace). Reads, greps, shell commands, and failed calls contribute nothing —
  result metadata alone is never treated as production (0.1.1).
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
- **Zero dependencies.** No React of its own (`require('react')` uses the browser's
  copy), no build step, no network call.

## Install

Requirements: the DSH Web UI or desktop app (developed and verified on `0.2.1-rc.3`),
and a Harness Host running on the same desktop as your browser — the point is to open
a local file manager.

Install into **the profile your Harness actually boots**, which is the one thing that
usually goes wrong:

| You run | Profile to install into |
| --- | --- |
| the **desktop app** (`DeepSeek Harness.exe`) | `--profile desktop` |
| the **web launcher** (`dsh --profile web`, opened in a browser) | `--profile web` |

```sh
# desktop app
dsh plugin --profile desktop add "github:danchaw/dsh-reveal-in-folder"

# web UI
dsh plugin --profile web add "github:danchaw/dsh-reveal-in-folder"
```

Pin a release instead of the moving `main` branch by appending `#v0.1.2`.

You can also install from the **Plugins** page in the UI. A brand-new bundle is picked
up live — the renderer fetches it as a new module revision, no restart needed.
*Replacing* a version that is already loaded needs an app restart (or a page reload)
before the new module generation is used.

Install from a local checkout while developing:

```sh
dsh plugin --profile desktop add "C:\Users\you\Documents\DSH\dsh-reveal-in-folder"
```

Remove it:

```sh
dsh plugin --profile desktop remove dsh-reveal-in-folder
```

## Configuration

None. The plugin adds no tool, no prompt, no setting, and no network endpoint.

## Troubleshooting

- **No icon anywhere, although the install succeeded.** Almost always a profile
  mismatch — the plugin is installed in a profile that the running app does not boot.
  Check with `dsh plugin --profile desktop why dsh-reveal-in-folder`, and remember the
  desktop app ignores `--profile web`.
- **No icon on this particular turn.** Expected: the row only appears on turns where
  the assistant actually wrote or edited a file. Read-only turns have none, and files
  a shell command created appear on the official deliverables card instead (that card
  already has its own reveal button).
- **The row is there but the icon does nothing / turns red.** The Host rejected the
  path — it only reveals paths that resolve inside a workspace it verified as local to
  this desktop. Remote or container-side workspaces are refused by design.
- **Nothing at all on a headless host.** Expected: with no file manager available the
  whole row stays hidden.

## Repository layout

| Path | What it is |
| --- | --- |
| `lib/index.js` | Host half — deliberately empty; the reveal operation stays in the Host. |
| `lib/client.js` | Browser module: the event `Definition`, the turn-tail entry, the 📂 button. |
| `cordis.patch.yml` | The composition row Plugin Manager inserts on install. |
| `locale/en.json`, `locale/zh.json` | Bundle display metadata for the plugins page. |
| `icon.svg` | Bundle icon (original artwork, MIT). |
| `CHANGELOG.md` | Release notes. |
| `test/` | `node --test` suite: manifest checks plus a headless runtime smoke (a hook-backed renderer runs the event fold, the capability gate, and a click). |

## Security notes

The plugin ships **no HTTP route and spawns no process**. Revealing a folder is a
Host-side capability that already exists and is already guarded (it verifies that the
path resolves inside a desktop-verified workspace). A second plugin-local
implementation would double the attack surface for the same result, so this bundle is
UI-only and calls the official entry point.

## Development

```sh
npm test
```

No dependencies, no build step — `lib/client.js` is the plain browser module DSH loads
(`window.__ModuleLoader__`). The test suite drives that module with a stub `ctx` and a
hook-backed renderer, so the fold logic and the click path are covered without a
browser.

## Known limits

- Only files produced by `write` / `edit` / `str_replace_editor` / `apply_patch` are
  listed. A file created by a shell command shows up on the deliverables card only
  after the model `present`s it — and that card already has its own reveal button.
- At most 24 chips per turn; the rest collapse into a "{count} more files" note.
- The row is per turn: files from earlier turns are not re-listed. Scroll to the turn
  that produced them, or use the deliverables card.

## License

MIT — see [LICENSE](LICENSE).
