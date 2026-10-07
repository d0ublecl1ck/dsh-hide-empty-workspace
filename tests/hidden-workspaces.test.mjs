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
      if (name === '@deepseek-ai/dsh-client-ui-primitives') {
        return { Button: () => null, Modal: () => null }
      }
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

test('counts only workspace rows', async () => {
  const { countWorkspaceRows } = await loadPlugin()
  const rows = [
    { key: 'workspace:w1' },
    { key: 'workspace:w2' },
    { key: 'session:s1' },
    { key: 'empty' },
  ]
  const seen = []
  const scope = {
    querySelectorAll: (selector) => {
      seen.push(selector)
      return rows.filter((row) => row.key.startsWith('workspace:'))
    },
  }
  assert.equal(countWorkspaceRows(scope), 2)
  assert.deepEqual(seen, ['[data-row-key^="workspace:"]'])
})

test('reports a marker mismatch when workspaces exist but no workspace row does', async () => {
  const { diagnoseRowMarkers } = await loadPlugin()
  assert.deepEqual(diagnoseRowMarkers(2, 0), { workspaceCount: 2, matchedRowCount: 0 })
})

test('stays quiet while at least one workspace row is present, and without workspaces', async () => {
  const { diagnoseRowMarkers } = await loadPlugin()
  assert.equal(diagnoseRowMarkers(2, 1), null)
  assert.equal(diagnoseRowMarkers(2, 2), null)
  assert.equal(diagnoseRowMarkers(0, 0), null)
  assert.equal(diagnoseRowMarkers(undefined, 0), null)
})

test('stays quiet when the sidebar is collapsed into its rail', async () => {
  const { diagnoseRowMarkers, workspaceRowsRendered } = await loadPlugin()
  const bare = { querySelector: () => null }
  assert.equal(workspaceRowsRendered(false, bare), false)
  const collapsed = { querySelector: (selector) => (selector === '[data-sidebar-collapsed]' ? {} : null) }
  assert.equal(workspaceRowsRendered(true, collapsed), false)
  assert.equal(diagnoseRowMarkers(34, 0, workspaceRowsRendered(false, bare)), null)
  assert.equal(diagnoseRowMarkers(34, 0, workspaceRowsRendered(true, collapsed)), null)
})

test('stays quiet in the single-list grouping, where workspace rows do not exist by design', async () => {
  const { diagnoseRowMarkers, workspaceRowsRendered } = await loadPlugin()
  const flat = { querySelector: (selector) => (selector === '[class*="flatList"]' ? {} : null) }
  assert.equal(workspaceRowsRendered(true, flat), false)
  assert.equal(diagnoseRowMarkers(34, 0, workspaceRowsRendered(true, flat)), null)
})

test('still reports the mismatch when the sidebar should be rendering workspace rows', async () => {
  const { diagnoseRowMarkers, workspaceRowsRendered } = await loadPlugin()
  const grouped = { querySelector: () => null }
  assert.equal(workspaceRowsRendered(true, grouped), true)
  assert.deepEqual(diagnoseRowMarkers(2, 0, workspaceRowsRendered(true, grouped)), { workspaceCount: 2, matchedRowCount: 0 })
})

test('spells the mismatch warning in one place', async () => {
  const { markerWarningText, markerWarningDetail } = await loadPlugin()
  assert.equal(markerWarningText(), '⚠ 工作区行标记失配，插件未生效')
  assert.match(markerWarningDetail(3), /3 个工作区/)
  assert.match(markerWarningDetail(3), /data-row-key/)
})

test('reads the workspace id out of a row marker, and nothing else', async () => {
  const { workspaceKeyFromRowKey } = await loadPlugin()
  assert.equal(workspaceKeyFromRowKey('workspace:w1'), 'w1')
  assert.equal(workspaceKeyFromRowKey('workspace:'), undefined)
  assert.equal(workspaceKeyFromRowKey('session:s1'), undefined)
  assert.equal(workspaceKeyFromRowKey(undefined), undefined)
})

test('treats only a click inside a workspace row as a workspace-menu request', async () => {
  const { workspaceKeyFromTarget } = await loadPlugin()
  const target = (rowKey) => ({ closest: () => (rowKey === undefined ? null : { getAttribute: () => rowKey }) })
  assert.equal(workspaceKeyFromTarget(target('workspace:w1')), 'w1')
  assert.equal(workspaceKeyFromTarget(target('session:s1')), undefined)
  assert.equal(workspaceKeyFromTarget(target(undefined)), undefined)
  assert.equal(workspaceKeyFromTarget(null), undefined)
})

test('arms the workspace menu entry from a click inside that row', async () => {
  const { stepMenuArm } = await loadPlugin()
  assert.equal(stepMenuArm(null, { type: 'click', key: 'w1' }), 'w1')
  assert.equal(stepMenuArm('w1', { type: 'click', key: 'w2' }), 'w2')
})

test('drops the armed workspace menu as soon as a click lands outside every workspace row', async () => {
  const { stepMenuArm } = await loadPlugin()
  assert.equal(stepMenuArm('w1', { type: 'click', key: undefined }), null)
})

test('consumes the armed key once the entry has been appended, so the next menu stays clean', async () => {
  const { stepMenuArm } = await loadPlugin()
  assert.equal(stepMenuArm('w1', { type: 'injected' }), null)
  assert.equal(stepMenuArm(null, { type: 'injected' }), null)
})

test('drops an arm that outlived the click, so a later menu stays clean', async () => {
  const { stepMenuArm } = await loadPlugin()
  assert.equal(stepMenuArm('w1', { type: 'expired' }), null)
})

test('never arms anything without a workspace-row click', async () => {
  const { stepMenuArm } = await loadPlugin()
  assert.equal(stepMenuArm(null, { type: 'click', key: undefined }), null)
})

test('spells the workspace menu entry in one place', async () => {
  const { hideMenuItemText } = await loadPlugin()
  assert.equal(hideMenuItemText(), '隐藏工作区')
})

test('spells the restore dialog copy in one place', async () => {
  const { restoreDialogText } = await loadPlugin()
  assert.deepEqual(restoreDialogText(), {
    title: '已隐藏的工作区',
    description: '这些工作区已从侧栏隐藏，恢复后重新显示。',
    restore: '恢复',
    close: '关闭',
  })
})
