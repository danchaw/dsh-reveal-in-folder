/**
 * Headless runtime smoke for the client half.
 *
 * The bundle is a `window.__ModuleLoader__` module whose React surface is only
 * `createElement` / `useState` / `useRef` / `useEffect`, so this test supplies a
 * tiny hook-backed renderer: it invokes the component functions itself, keeps one
 * slot array per component instance (keyed by tree path), and rebuilds the tree
 * from the root after each state change. That is enough to exercise the parts a
 * manifest check cannot see — the event fold, the capability gate, and what a
 * click actually sends to the Host. No dependencies.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FOLD_KIND = 'reveal-in-folder-files'

// ── mini renderer ────────────────────────────────────────────────────────────

function createElement(type, config, ...children) {
  const props = { ...(config ?? {}) }
  const flat = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)
  props.children = flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat
  return { type, props }
}

/** A `react` stub whose hooks bind to whichever component is executing. */
function createReact() {
  const api = { createElement }
  let instance = null
  api.useState = (initial) => {
    const index = instance.cursor++
    if (instance.slots.length <= index) {
      instance.slots.push(typeof initial === 'function' ? initial() : initial)
    }
    const target = instance
    return [
      target.slots[index],
      (next) => {
        target.slots[index] = typeof next === 'function' ? next(target.slots[index]) : next
      },
    ]
  }
  api.useRef = (initial) => {
    const index = instance.cursor++
    if (instance.slots.length <= index) instance.slots.push({ current: initial === undefined ? null : initial })
    return instance.slots[index]
  }
  api.useEffect = () => {}
  api.Fragment = 'Fragment'
  return {
    react: api,
    run(component, props, slots) {
      const previous = instance
      instance = { cursor: 0, slots }
      try {
        return component(props)
      } finally {
        instance = previous
      }
    },
  }
}

/** Render `element`, reusing per-path hook slots across renders. */
function createRenderer(harness) {
  const instances = new Map()
  function step(element, trail) {
    if (element === null || element === undefined || typeof element !== 'object') return element
    if (Array.isArray(element)) return element.map((item, index) => step(item, `${trail}[${index}]`))
    if (typeof element.type !== 'function') {
      const children = element.props?.children
      if (children === undefined) return element
      return { type: element.type, props: { ...element.props, children: step(children, `${trail}>c`) } }
    }
    const key = element.props.key === undefined ? '' : String(element.props.key)
    const id = `${trail}#${element.type.name}#${key}`
    let slots = instances.get(id)
    if (slots === undefined) {
      slots = []
      instances.set(id, slots)
    }
    return step(harness.run(element.type, element.props, slots), id)
  }
  return { step, instances }
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  visit(node)
  if (node.props?.children !== undefined) walk(node.props.children, visit)
}

function find(node, predicate) {
  let hit = null
  walk(node, (element) => {
    if (hit === null && predicate(element)) hit = element
  })
  return hit
}

// ── bundle loading ───────────────────────────────────────────────────────────

async function loadClient() {
  const source = readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  const registered = []
  const sandboxWindow = { __ModuleLoader__: { load: (entry) => registered.push(entry) } }
  new Function('window', source)(sandboxWindow)
  assert.equal(registered.length, 1, 'exactly one module registration')
  assert.equal(registered[0].id, 'dsh-reveal-in-folder')

  const harness = createReact()
  const exports = registered[0].factory((name) => {
    assert.equal(name, 'react', 'the factory requires nothing but react')
    return harness.react
  })
  return { exports, renderer: createRenderer(harness), harness }
}

function createContext(session) {
  const seen = { effects: [], listeners: [], definitions: [], injected: [], registered: [] }
  const ctx = {
    effect: (run) => seen.effects.push(run()),
    on: (name, handler) => seen.listeners.push([name, handler]),
    locale: {
      register: (ns, dictionaries) => seen.dictionaries = { ns, ...dictionaries },
      bind: () => (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`),
    },
    uiConversation: { events: { register: (definition) => seen.definitions.push(definition) } },
    slots: {
      inject: (name, build) => {
        seen.injected.push(name)
        seen.entry = build()
      },
      register: (options, component) => {
        seen.registered.push(options)
        return { options, component }
      },
    },
    remote: { session },
    seen,
  }
  return { ctx, seen }
}

function fakeSession({ available = true, record = [], outcome } = {}) {
  return {
    canOpenWorkspacePath: async () => ({ ok: true, value: available }),
    openWorkspacePath: async (request) => {
      record.push(request)
      return outcome ?? { ok: true, value: { opened: true } }
    },
  }
}

/** The owner props a turnTail entry receives, plus the injected plugin services. */
function tailProps(files, { seq = 9, cwd = 'C:\\workspace' } = {}) {
  return { turn: { data: new Map([[FOLD_KIND, { files }]]) }, seq, sessionId: 's1', useSessions: (selector) => selector({ byId: { s1: { cwd } } }), openFile() {} }
}

/** Apply the bundle to a mocked ctx and render its turnTail entry with real hooks. */
function attach(bundle, session, files, options) {
  const { ctx } = createContext(session)
  bundle.exports.apply(ctx)
  const entry = ctx.seen.entry
  const injected = entry.options.inject()
  const props = { ...tailProps(files, options), ...injected }
  return { ctx, capability: injected.capability, render: () => bundle.renderer.step({ type: entry.component, props }, 'root') }
}

/** Mount, probe the capability, then render. */
async function mount(bundle, files, options) {
  const attached = attach(bundle, fakeSession({ available: true }), files, options)
  await attached.capability.load()
  attached.tree = attached.render()
  return attached
}

// ── module shape ─────────────────────────────────────────────────────────────

test('the bundle registers the documented surfaces and no Host route', async () => {
  const bundle = await loadClient()
  assert.equal(typeof bundle.exports.apply, 'function')
  assert.deepEqual(bundle.exports.inject, ['slots', 'locale', 'uiConversation', 'remote', 'remote.session'])

  const { ctx, seen } = createContext(fakeSession())
  bundle.exports.apply(ctx)
  assert.deepEqual(seen.injected, ['conversation.chat.turnTail'])
  assert.equal(seen.definitions.length, 1, 'one conversation Definition')
  assert.equal(seen.entry.options.id, 'dsh-reveal-in-folder.turn-tail')
  assert.equal(seen.entry.options.name, 'conversation.chat.turnTail')
  assert.equal(seen.entry.options.order, 5)
  assert.equal(seen.dictionaries.ns, 'dsh-reveal-in-folder')
  assert.deepEqual(Object.keys(seen.dictionaries.zh).sort(), Object.keys(seen.dictionaries.en).sort())
  assert.equal(seen.listeners[0][0], 'connection/reset')
})

// ── the fold ─────────────────────────────────────────────────────────────────

function foldOf(bundle) {
  const { ctx } = createContext(fakeSession())
  bundle.exports.apply(ctx)
  return ctx.seen.definitions[0]
}

test('the fold records successful mutations and ignores everything else', async () => {
  const fold = foldOf(await loadClient())

  assert.deepEqual(fold.match({ type: 'turn/start', seq: 1, data: { turn: 1 } }), { id: '1', role: 'start' })
  assert.deepEqual(fold.match({ type: 'tool/call', seq: 2, data: { turn: 1 } }), { id: '1', role: 'update' })
  assert.equal(fold.match({ type: 'tool/result', seq: 3, data: { turn: 1 } }), null, 'a non-append result is not surface content')
  assert.equal(fold.match({ type: 'assistant/message', seq: 3, data: { turn: 1 } }), null)

  let state = fold.start({}, { event: { type: 'turn/start', seq: 1, data: { turn: 1 } } })
  const step = (event) => {
    state = fold.update({ state }, { event })
    return state.files
  }

  assert.deepEqual(
    step({ type: 'tool/call', seq: 2, data: { turn: 1, callId: 'c1', name: 'write', arguments: JSON.stringify({ file_path: 'notes.md', content: 'x' }) } }),
    [],
    'a call contributes nothing before it settles',
  )
  assert.deepEqual(
    step({ type: 'tool/result', seq: 3, surfaceOp: 'append', data: { turn: 1, message: { source: { callId: 'c1' } }, meta: { path: 'C:\\workspace\\notes.md' } } }),
    [{ seq: 3, path: 'C:\\workspace\\notes.md' }],
    'the recorded absolute path replaces the argument spelling',
  )

  step({ type: 'tool/call', seq: 4, data: { turn: 1, callId: 'c2', name: 'edit', arguments: JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'y' }) } })
  assert.equal(step({ type: 'tool/result', seq: 5, surfaceOp: 'append', data: { turn: 1, message: { isError: true, source: { callId: 'c2' } } } }).length, 1, 'a failed call contributes nothing')

  assert.equal(
    step({ type: 'tool/call', seq: 6, data: { turn: 1, callId: 'c3', name: 'apply_patch', arguments: JSON.stringify({ input: '*** Add File: one.txt\n*** Add File: two.txt\n*** Add File: one.txt' }) } }).length,
    1,
    'a patch contributes nothing before it settles',
  )
  assert.deepEqual(
    step({ type: 'tool/result', seq: 7, surfaceOp: 'append', data: { turn: 1, message: { source: { callId: 'c3' } } } }).slice(1),
    [{ seq: 7, path: 'one.txt' }, { seq: 7, path: 'two.txt' }],
    'patch targets are deduplicated',
  )

  // Real Harness results carry the opened path in `meta.path` even for read-only
  // tools; a earlier fixture omitted it and so hid a bug that advertised every
  // viewed file as a produced one.
  step({ type: 'tool/call', seq: 8, data: { turn: 1, callId: 'c4', name: 'read', arguments: JSON.stringify({ file_path: 'notes.md' }) } })
  assert.equal(step({ type: 'tool/result', seq: 9, surfaceOp: 'append', data: { turn: 1, message: { source: { callId: 'c4' } }, meta: { path: 'C:\\workspace\\viewed.md' } } }).length, 3, 'reads contribute nothing even when their result records a path')
  step({ type: 'tool/call', seq: 10, data: { turn: 1, callId: 'c5', name: 'pwsh', arguments: JSON.stringify({ command: 'Get-ChildItem' }) } })
  assert.equal(step({ type: 'tool/result', seq: 11, surfaceOp: 'append', data: { turn: 1, message: { source: { callId: 'c5' } }, meta: { path: 'C:\\workspace\\other.md' } } }).length, 3, 'a shell result never becomes a produced file')

  const located = fold.buildLocationData({ state }, 'turn', null)
  assert.deepEqual(located, { kind: 'turn', turn: 1, key: FOLD_KIND, value: { files: state.files } })
  assert.equal(fold.buildLocationData({ state }, 'session', null), null, 'turn scope only')
  assert.equal(fold.buildLocationData({ state }, 'turn', located), located, 'reference-equal state is not re-published')
})

// ── the row ──────────────────────────────────────────────────────────────────

test('the row waits for the Host capability, then lists each produced file once', async () => {
  const bundle = await loadClient()
  const files = [
    { seq: 3, path: 'C:\\workspace\\notes.md' },
    { seq: 4, path: 'notes.md' },
    { seq: 12, path: 'later.md' },
  ]
  const mounted = await mount(bundle, files)
  const chips = []
  walk(mounted.tree, (element) => {
    if (element.props?.className === 'dsh-rif-chip') chips.push(element)
  })
  assert.equal(chips.length, 1, 'deduplicated after resolving against the workspace; the future turn is excluded by seq')

  const name = find(mounted.tree, (element) => element.props?.className === 'dsh-rif-name')
  assert.equal(name.props.children, 'notes.md')
  assert.equal(name.props.title, 'C:\\workspace\\notes.md', 'relative paths resolve against the session workspace')
  assert.equal(find(mounted.tree, (element) => element.props?.['data-reveal-in-folder'] === 'turn-tail') !== null, true)

  // Nothing produced -> no row at all.
  const empty = await mount(bundle, [])
  assert.equal(empty.tree, null)

  // No desktop -> no row, even with files.
  const headless = createContext(fakeSession({ available: false }))
  bundle.exports.apply(headless.ctx)
  const injected = headless.ctx.seen.entry.options.inject()
  await injected.capability.load()
  const { props } = tailProps(files)
  assert.equal(bundle.harness.run(headless.ctx.seen.entry.component, { ...props, ...injected }, []), null, 'the icon stays hidden where reveal is impossible')
})

// ── the click ────────────────────────────────────────────────────────────────

test('clicking the folder icon sends one reveal request with an absolute path', async () => {
  const bundle = await loadClient()
  const record = []
  const attached = attach(bundle, fakeSession({ available: true, record }), [{ seq: 3, path: 'report.md' }])
  await attached.capability.load()

  const tree = attached.render()
  const button = find(tree, (element) => element.props?.['data-reveal-in-folder'] === 'button')
  assert.ok(button, 'each chip carries one reveal button')
  assert.equal(button.props.disabled, false)
  assert.equal(button.props.title, 'action.reveal')

  await button.props.onClick()
  assert.deepEqual(record, [{ path: 'C:\\workspace\\report.md', action: 'reveal' }], 'one call, reveal action, absolute path')

  const settled = find(attached.render(), (element) => element.props?.['data-reveal-in-folder'] === 'button')
  assert.equal(settled.props['data-state'], 'done', 'the button reports success in place')
})

test('a Host rejection reports failure instead of silence', async () => {
  const bundle = await loadClient()
  const record = []
  const attached = attach(
    bundle,
    fakeSession({ available: true, record, outcome: { ok: false, error: { code: 'gateway/bad-request', message: 'Path has no verified Host path' } } }),
    [{ seq: 3, path: '../outside.md' }],
  )
  await attached.capability.load()

  const button = find(attached.render(), (element) => element.props?.['data-reveal-in-folder'] === 'button')
  await button.props.onClick()
  assert.equal(record.length, 1)
  const settled = find(attached.render(), (element) => element.props?.['data-reveal-in-folder'] === 'button')
  assert.equal(settled.props['data-state'], 'failed')
  assert.equal(settled.props.title, 'status.failed')
})
