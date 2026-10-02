import test from 'node:test'
import assert from 'node:assert/strict'

/** Load the browser-half module under a fake ModuleLoader and return its internals. */
let internalsPromise
async function loadPlugin() {
  internalsPromise ??= (async () => {
    let definition
    globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } } }
    await import('../client.js')
    assert.equal(definition.id, 'dsh-hide-empty-workspace')
    const mod = definition.factory((name) => {
      if (name === 'react') {
        return {
          createElement: () => null,
          useMemo: (fn) => fn(),
          useEffect: () => {},
          useRef: () => ({ current: undefined }),
          useState: (value) => [value, () => {}],
        }
      }
      throw new Error('unexpected require: ' + name)
    })
    return mod.internals
  })()
  return internalsPromise
}

const workspace = (workspaceId, sessionIds) => ({ workspaceId, sessionIds, title: workspaceId })
const session = (id, mainView = 0) => ({ id, retainedBy: { mainView } })

test('counts only live sessions per workspace', async () => {
  const { liveSessionCounts } = await loadPlugin()
  const counts = liveSessionCounts(
    { items: [workspace('w1', ['s1', 's2']), workspace('w2', ['s3'])] },
    { byId: { s1: session('s1'), s2: session('s2'), s3: session('s3') } },
    ['s2'],
  )
  assert.deepEqual(counts, { w1: 1, w2: 1 })
})

test('counts every non-archived session id, even without a snapshot summary', async () => {
  const { liveSessionCounts } = await loadPlugin()
  const counts = liveSessionCounts(
    { items: [workspace('w1', ['s1', 'gone'])] },
    { byId: { s1: session('s1') } },
    ['s1'],
  )
  assert.deepEqual(counts, { w1: 1 })
})

test('never hides a workspace it has not seen before', async () => {
  const { stepHidden } = await loadPlugin()
  const result = stepHidden({}, { w1: 0 }, [])
  assert.deepEqual([...result.hidden], [])
  assert.deepEqual(result.counts, { w1: 0 })
})

test('hides a workspace the moment its last live session is archived', async () => {
  const { stepHidden } = await loadPlugin()
  const result = stepHidden({ w1: 1 }, { w1: 0 }, [])
  assert.deepEqual([...result.hidden], ['w1'])
})

test('also hides when several live sessions drop straight to zero', async () => {
  const { stepHidden } = await loadPlugin()
  const result = stepHidden({ w1: 3 }, { w1: 0 }, [])
  assert.deepEqual([...result.hidden], ['w1'])
})

test('does not hide while at least one live session remains', async () => {
  const { stepHidden } = await loadPlugin()
  const result = stepHidden({ w1: 2 }, { w1: 1 }, [])
  assert.deepEqual([...result.hidden], [])
})

test('keeps an already hidden workspace hidden while it stays empty', async () => {
  const { stepHidden } = await loadPlugin()
  const result = stepHidden({ w1: 0 }, { w1: 0 }, ['w1'])
  assert.deepEqual([...result.hidden], ['w1'])
})

test('un-hides a workspace once a live session appears again', async () => {
  const { stepHidden } = await loadPlugin()
  const result = stepHidden({ w1: 0 }, { w1: 1 }, ['w1'])
  assert.deepEqual([...result.hidden], [])
})

test('effectiveHiddenSet drops the currently selected workspace', async () => {
  const { effectiveHiddenSet } = await loadPlugin()
  assert.deepEqual([...effectiveHiddenSet(new Set(['w1', 'w2']), 'w1')], ['w2'])
  assert.deepEqual([...effectiveHiddenSet(new Set(['w1']), undefined)], ['w1'])
})

test('finds the workspace that owns the selected session', async () => {
  const { currentWorkspaceKey } = await loadPlugin()
  assert.equal(currentWorkspaceKey(
    { items: [workspace('w1', ['s1']), workspace('w2', [])] },
    { byId: { s1: session('s1', 1) } },
  ), 'w1')
  assert.equal(currentWorkspaceKey({ items: [] }, { byId: {} }), undefined)
})

test('applies hidden state to matching rows and clears the rest', async () => {
  const { applyRowVisibility } = await loadPlugin()
  const rows = [
    { key: 'workspace:w1', style: { display: '' } },
    { key: 'workspace:w2', style: { display: 'none' } },
    { key: 'workspace:', style: { display: '' } },
    { key: 'session:s1', style: { display: '' } },
  ]
  globalThis.document = {
    querySelectorAll: () => rows.map((row) => ({
      getAttribute: () => row.key,
      style: row.style,
    })),
  }
  applyRowVisibility(new Set(['w2']))
  assert.deepEqual(rows.map((row) => row.style.display), ['', 'none', '', ''])
})

test('never hides the ungrouped bucket', async () => {
  const { effectiveHiddenSet } = await loadPlugin()
  assert.deepEqual([...effectiveHiddenSet(new Set(['']), undefined)], [''])
})
