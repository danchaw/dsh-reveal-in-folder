# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-10-28

### Changed

- Documentation only — `lib/client.js` is byte-identical to 0.1.1. The install
  section now names the profile each launcher boots (the desktop app reads
  `--profile desktop`, not `--profile web`), which is the failure mode most users
  hit; adds a troubleshooting section; and states the rule 0.1.1 introduced: a
  tool result's path metadata alone is never treated as a produced file. Tagged so
  the release artifact carries the same README as the repository page.

## [0.1.1] - 2026-10-28

### Fixed

- A turn row no longer lists files the assistant merely opened. Read-only tool
  results (`read`, `grep`, `pwsh`, …) carry the path they touched in result
  metadata, and that metadata took precedence over the recorded call, so every
  viewed file was advertised as produced by the turn. The fold now drops any
  result whose originating call was not a write. Found by replaying a real
  session log through the bundle; the unit fixture had omitted `meta.path` on
  its read-only case, which is why it had stayed green.

## [0.1.0] - 2026-10-28

### Added

- First release. A folder icon beside every file a turn produced, which reveals
  that file in the system file manager through the Host's own
  `openWorkspacePath` entry point, plus a name button that opens the file in the
  document panel. The row stays hidden until the Host reports a usable file
  manager.

[0.1.2]: https://github.com/danchaw/dsh-reveal-in-folder/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/danchaw/dsh-reveal-in-folder/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/danchaw/dsh-reveal-in-folder/releases/tag/v0.1.0
