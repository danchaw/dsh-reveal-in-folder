/**
 * dsh-reveal-in-folder — host half.
 *
 * Intentionally empty. Revealing a file in the system file manager is already a
 * first-class Host capability: `session.openWorkspacePath({ path, action:
 * 'reveal' })` (see `@deepseek-ai/dsh-api-session-controller`) dispatches to the
 * native path opener — Explorer `/select`, macOS `open -R`, `xdg-open`, and the
 * WSL bridge — behind its own desktop-path verification, and
 * `session.canOpenWorkspacePath()` reports whether a desktop file manager exists.
 *
 * This plugin therefore contributes UI only, and its button calls that one Host
 * entry point. Keeping the operation in the Host means a headless Host behaves
 * exactly as the official deliverables cards do (the icon stays hidden), and no
 * second, plugin-local path-opening surface is added.
 *
 * @returns nothing; the bundle carries no host-side resources.
 */
export function apply() {}
