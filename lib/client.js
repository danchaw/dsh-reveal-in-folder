/**
 * dsh-reveal-in-folder — client half.
 *
 * Adds one row at the tail of an assistant turn: every file the turn produced
 * (successful `write` / `edit` / mutating `str_replace_editor` / `apply_patch`
 * calls) becomes a chip, and every chip ends with a folder icon that reveals the
 * file's containing folder in the Host's native file manager.
 *
 * The click does not implement any path opening of its own. It calls the Host
 * entry point the official UI already uses — `session.openWorkspacePath({ path,
 * action: 'reveal' })` from `@deepseek-ai/dsh-api-session-controller` — so there
 * is exactly one reveal implementation (Explorer `/select`, macOS `open -R`,
 * `xdg-open`, WSL) with its own desktop-verification guard, and the plugin ships
 * no Host route of its own.
 *
 * The file list comes from a Conversation Location `Definition` registered on
 * `ctx.uiConversation.events` — the same framework channel the official
 * deliverables bundle uses — so turn membership is owned by the engine, not by
 * DOM scraping or a private reducer.
 */
window.__ModuleLoader__.load({
  id: 'dsh-reveal-in-folder',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')

    const NS = 'dsh-reveal-in-folder'
    const TAIL_ID = 'dsh-reveal-in-folder.turn-tail'
    const FOLD_KIND = 'reveal-in-folder-files'
    const STYLE_ID = 'dsh-rif-style'
    const MAX_FILES = 24

    const zh = {
      'row.label': '本轮生成的文件',
      'action.reveal': '打开所在文件夹',
      'action.open': '打开文件',
      'status.busy': '正在打开…',
      'status.done': '已打开所在文件夹',
      'status.failed': '无法打开所在文件夹',
      'row.more': '还有 {count} 个文件',
    }
    const en = {
      'row.label': 'Files from this turn',
      'action.reveal': 'Reveal in folder',
      'action.open': 'Open file',
      'status.busy': 'Opening…',
      'status.done': 'Folder opened',
      'status.failed': 'Could not open the folder',
      'row.more': '{count} more files',
    }

    const CSS = [
      '.dsh-rif-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px;}',
      '.dsh-rif-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
      '.dsh-rif-chip{display:inline-flex;align-items:center;max-width:100%;border:0.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;}',
      '.dsh-rif-name{max-width:220px;padding:1px 2px 1px 7px;border:0;background:transparent;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}',
      '.dsh-rif-name:hover{color:var(--dsw-alias-label-primary);}',
      '.dsh-rif-reveal{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:1px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}',
      '.dsh-rif-reveal:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
      '.dsh-rif-reveal:disabled{cursor:default;opacity:.55;}',
      '.dsh-rif-reveal[data-state="done"]{color:var(--dsw-alias-state-success-primary);}',
      '.dsh-rif-reveal[data-state="failed"]{color:var(--dsw-alias-state-error-primary);}',
      '.dsh-rif-more{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
    ].join('')

    /** Register the plugin stylesheet once, and remove it when the scope disposes. */
    function registerStyle() {
      if (typeof document === 'undefined') return () => {}
      if (document.getElementById(STYLE_ID) !== null) return () => {}
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    // ─────────────────────────── paths ───────────────────────────

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /** Absolute in either spelling the Host accepts: POSIX, Windows drive, or UNC. */
    function isAbsolutePath(value) {
      return value.startsWith('/') || /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')
    }

    /** Join a workspace-relative path onto the session root; absolute paths pass through. */
    function resolveWithCwd(cwd, value) {
      if (isAbsolutePath(value) || typeof cwd !== 'string' || cwd === '') return value
      const separator = cwd.includes('\\') ? '\\' : '/'
      return cwd.replace(/[/\\]+$/, '') + separator + value.replace(/^[/\\]+/, '')
    }

    function basenameOf(value) {
      const parts = value.split(/[/\\]/).filter(Boolean)
      return parts.length === 0 ? value : parts[parts.length - 1]
    }

    /** Per-session selectors, so the snapshot hook keeps a stable identity. */
    const cwdSelectors = new Map()
    function selectCwd(sessionId) {
      let selector = cwdSelectors.get(sessionId)
      if (selector === undefined) {
        selector = (state) => state?.byId?.[sessionId]?.cwd
        cwdSelectors.set(sessionId, selector)
      }
      return selector
    }

    /** A non-blank path keeps the exact spelling the model supplied. */
    function pathValue(value) {
      return typeof value === 'string' && value.trim().length > 0 ? value : null
    }

    /**
     * The path a first-party mutation call targets, or null when the call is not a
     * supported mutation. Mirrors the official deliverables contract: reads,
     * unsupported tools, and malformed arguments contribute nothing.
     */
    function mutationPath(name, argsRaw) {
      let args
      try {
        args = JSON.parse(argsRaw)
      } catch {
        return null
      }
      if (!isRecord(args)) return null
      switch (name) {
        case 'write':
          return typeof args.content === 'string' ? pathValue(args.file_path) : null
        case 'edit':
          return typeof args.old_string === 'string' &&
            args.old_string.length > 0 &&
            typeof args.new_string === 'string' &&
            args.old_string !== args.new_string
            ? pathValue(args.file_path)
            : null
        case 'str_replace_editor': {
          const path = pathValue(args.path)
          if (path === null) return null
          switch (args.command) {
            case 'create':
              return typeof args.file_text === 'string' ? path : null
            case 'str_replace':
              return typeof args.old_str === 'string' && args.old_str.length > 0 ? path : null
            case 'insert':
              return typeof args.insert_line === 'number' && typeof args.new_str === 'string' ? path : null
            default:
              return null
          }
        }
        case 'apply_patch': {
          const input = typeof args.input === 'string' ? args.input : typeof args.patch === 'string' ? args.patch : ''
          const paths = []
          for (const found of input.matchAll(/^\*\*\* (?:Add|Update|Move to) File: (.+)$/gm)) {
            const path = pathValue(found[1].trim())
            if (path !== null && !paths.includes(path)) paths.push(path)
          }
          return paths.length === 0 ? null : paths
        }
        default:
          return null
      }
    }

    /**
     * Flatten one recorded target into strings: `apply_patch` may hold several
     * paths, and the engine records the final absolute path in result metadata
     * when the argument spelling differed.
     */
    function settledPaths(argumentPath, meta) {
      const arguments_ = argumentPath === null ? [] : Array.isArray(argumentPath) ? argumentPath : [argumentPath]
      const recorded = isRecord(meta) && Object.hasOwn(meta, 'path') ? pathValue(meta.path) : null
      if (recorded !== null) return [recorded]
      return arguments_.filter((value) => typeof value === 'string' && value.trim() !== '')
    }

    // ─────────────────────── turn-scoped fold ───────────────────────

    /** Turn-scoped produced-file Definition; it publishes no view node of its own. */
    const filesDefinition = {
      kind: FOLD_KIND,
      match(event) {
        if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
        if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
        if (event.type === 'tool/result' && event.surfaceOp === 'append') {
          return { id: String(event.data.turn), role: 'update' }
        }
        return null
      },
      start(_context, match) {
        if (match.event.type !== 'turn/start') throw new Error(FOLD_KIND + ': start requires turn/start')
        return { turn: match.event.data.turn, calls: new Map(), files: [] }
      },
      update(context, match) {
        const event = match.event
        if (event.type === 'tool/call') {
          const calls = new Map(context.state.calls)
          calls.set(String(event.data.callId), mutationPath(event.data.name, event.data.arguments))
          return { ...context.state, calls }
        }
        if (event.type !== 'tool/result') return context.state
        if (event.data.message?.isError === true) return context.state
        const callId = String(event.data.message?.source?.callId)
        if (!context.state.calls.has(callId)) return context.state
        const argumentPath = context.state.calls.get(callId)
        // A recorded call whose target is `null` came from a read-only tool. Its
        // result metadata still carries the path it opened, so filtering here is
        // what keeps a viewed file from being advertised as a produced one.
        if (argumentPath === null || argumentPath === undefined) return context.state
        const paths = settledPaths(argumentPath, event.data.meta)
        if (paths.length === 0) return context.state
        const files = [...context.state.files]
        const seen = new Set(files.map((file) => file.path))
        for (const path of paths) {
          if (seen.has(path)) continue
          seen.add(path)
          files.push({ seq: event.seq, path })
        }
        if (files.length === context.state.files.length) return context.state
        return { ...context.state, files }
      },
      buildLocationData(context, scope, previous) {
        if (scope !== 'turn' || context.state === undefined) return null
        if (
          previous?.kind === 'turn' &&
          previous.turn === context.state.turn &&
          previous.key === FOLD_KIND &&
          previous.value.files === context.state.files
        ) {
          return previous
        }
        return { kind: 'turn', turn: context.state.turn, key: FOLD_KIND, value: { files: context.state.files } }
      },
    }

    // ─────────────────── Host desktop capability ───────────────────

    /**
     * Cache the Host's native path-opening capability so one probe serves every
     * turn on screen, and re-probe on `connection/reset`.
     */
    function createCapability(session) {
      const listeners = new Set()
      let value = null
      let pending = null
      function publish(next) {
        value = next
        for (const listener of listeners) listener()
      }
      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        get: () => value,
        load() {
          if (pending !== null) return pending
          pending = (async () => {
            try {
              const result = await session.canOpenWorkspacePath()
              publish(result?.ok === true && result?.value === true)
            } catch {
              publish(false)
            } finally {
              pending = null
            }
            return value
          })()
          return pending
        },
        reveal(path) {
          return session.openWorkspacePath({ path, action: 'reveal' })
        },
      }
    }

    // ─────────────────────────── view ───────────────────────────

    function FolderGlyph() {
      return react.createElement(
        'svg',
        {
          width: 13,
          height: 13,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        react.createElement('path', {
          d: 'M2 12.2V4.6A1.1 1.1 0 0 1 3.1 3.5h3.2l1.4 1.9h5.2a1.1 1.1 0 0 1 1.1 1.1v5.7a1.1 1.1 0 0 1-1.1 1.1H3.1A1.1 1.1 0 0 1 2 12.2z',
        }),
      )
    }

    function RevealButton({ path, t, capability }) {
      const [state, setState] = react.useState('idle')
      const timer = react.useRef(null)
      react.useEffect(
        () => () => {
          if (timer.current !== null) clearTimeout(timer.current)
        },
        [],
      )
      const label = state === 'busy' ? t('status.busy') : state === 'failed' ? t('status.failed') : t('action.reveal')
      const reveal = async () => {
        setState('busy')
        let ok = false
        try {
          ok = (await capability.reveal(path))?.ok === true
        } catch {
          ok = false
        }
        setState(ok ? 'done' : 'failed')
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(() => setState('idle'), ok ? 1600 : 4000)
      }
      return react.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-rif-reveal',
          'data-reveal-in-folder': 'button',
          'data-state': state,
          title: label,
          'aria-label': label,
          disabled: state === 'busy',
          onClick: reveal,
        },
        FolderGlyph(),
      )
    }

    function FileChip({ file, t, openFile, capability }) {
      const name = basenameOf(file.path)
      return react.createElement(
        'span',
        { className: 'dsh-rif-chip', key: file.path },
        react.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-rif-name',
            title: file.path,
            'aria-label': t('action.open') + ' ' + name,
            onClick: () => openFile?.(file.path),
          },
          name,
        ),
        react.createElement(RevealButton, { path: file.path, t, capability }),
      )
    }

    function TurnTail(props) {
      const t = props.t
      const capability = props.capability
      const [available, setAvailable] = react.useState(capability.get)
      const useSessions = typeof props.useSessions === 'function' ? props.useSessions : () => undefined
      const cwd = useSessions(selectCwd(props.sessionId))
      react.useEffect(() => {
        const unsubscribe = capability.subscribe(() => setAvailable(capability.get()))
        capability.load()
        return unsubscribe
      }, [capability])
      if (available !== true) return null

      const recorded = props.turn?.data?.get?.(FOLD_KIND)?.files
      const paths = []
      const seen = new Set()
      for (const file of Array.isArray(recorded) ? recorded : []) {
        if (typeof file?.path !== 'string' || file.path === '') continue
        if (file.seq > props.seq) continue
        const resolved = resolveWithCwd(typeof cwd === 'string' ? cwd : '', file.path)
        if (seen.has(resolved)) continue
        seen.add(resolved)
        paths.push({ path: resolved, seq: file.seq })
      }
      if (paths.length === 0) return null

      const shown = paths.slice(0, MAX_FILES)
      const rest = paths.length - shown.length
      return react.createElement(
        'div',
        { className: 'dsh-rif-row', 'data-reveal-in-folder': 'turn-tail' },
        react.createElement('span', { className: 'dsh-rif-label' }, t('row.label')),
        shown.map((file) => react.createElement(FileChip, {
          key: file.path,
          file,
          t,
          openFile: props.openFile,
          capability,
        })),
        rest > 0 ? react.createElement('span', { className: 'dsh-rif-more' }, t('row.more', { count: rest })) : null,
      )
    }

    /**
     * Client plugin body: register the dictionary, the stylesheet, the turn-scoped
     * file Definition, and the folder-icon tail entry.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const capability = createCapability(ctx.remote.session)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), NS + ': dictionaries')
      ctx.effect(registerStyle, NS + ': stylesheet')
      const t = ctx.locale.bind(NS)
      ctx.on('connection/reset', () => capability.load())
      ctx.uiConversation.events.register(filesDefinition)
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        id: TAIL_ID,
        order: 5,
        locale: NS,
        label: () => t('action.reveal'),
        inject: () => ({ capability, t }),
      }, TurnTail))
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'uiConversation', 'remote', 'remote.session']
    return module.exports
  },
})
