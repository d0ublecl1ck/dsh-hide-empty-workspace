/**
 * Browser half: hide a sidebar Workspace group only at the moment its last
 * live (non-archived) Session disappears, plus an explicit right-click
 * "hide this workspace" action for every other case.
 *
 * Rationale: hiding on "has no live session" alone would hide a Workspace the
 * instant it is added (a fresh Workspace starts with zero Sessions). Instead the
 * automatic rule fires only on the 1 -> 0 transition of the live-Session count,
 * so a newly added Workspace stays visible until the user archives its last
 * Session. Manual hides are remembered until the user restores them or until a
 * live Session appears again.
 *
 * The shipped sidebar browser renders one `[data-row-key="workspace:<id>"]` row
 * per Workspace. This plugin never replaces that UI: an invisible host
 * component registered into a spare list slot subscribes to the standard
 * `useWorkspaces` / `useSessions` root hooks and only toggles `display` on the
 * shipped rows.
 */
window.__ModuleLoader__.load({
  id: 'dsh-hide-empty-workspace',
  factory(require) {
    const React = require('react')

    const WORKSPACE_ROW_PREFIX = 'workspace:'
    const STORAGE_KEY = 'dsh-hide-empty-workspace.hidden.v1'

    function asSet(value) {
      if (value instanceof Set) return value
      return new Set(Array.isArray(value) ? value : [])
    }

    /**
     * Live (present and not archived) Session count per Workspace.
     * @param workspaces - `useWorkspaces` snapshot (items).
     * @param sessions - `useSessions` snapshot (byId).
     * @param archivedIds - archived Session ids; defaults to `workspaces.archivedSessionIds`.
     * @returns plain object keyed by Workspace id.
     */
    function liveSessionCounts(workspaces, sessions, archivedIds) {
      const items = Array.isArray(workspaces?.items) ? workspaces.items : []
      const byId = sessions?.byId ?? {}
      const archived = archivedIds === undefined ? asSet(workspaces?.archivedSessionIds) : asSet(archivedIds)
      const counts = {}
      for (const item of items) {
        const key = item?.workspaceId
        if (key === undefined) continue
        const ids = Array.isArray(item.sessionIds) ? item.sessionIds : []
        counts[key] = ids.filter((id) => !archived.has(id)).length
      }
      return counts
    }

    /**
     * Apply the transition rules to the remembered hidden set.
     * - Workspace seen for the first time: only recorded, never hidden.
     * - live count 1+ -> 0: hidden ("last Session archived").
     * - live count 0 -> 1+: un-hidden (a live Session is back).
     * @param prevCounts - counts observed on the previous snapshot.
     * @param counts - counts of the current snapshot.
     * @param hidden - currently hidden Workspace ids.
     * @returns next hidden set and the counts to remember.
     */
    function stepHidden(prevCounts, counts, hidden) {
      const previous = prevCounts ?? {}
      const next = new Set(asSet(hidden))
      const nextCounts = { ...counts }
      for (const [key, live] of Object.entries(counts)) {
        const before = previous[key]
        if (before === undefined) continue
        if (before > 0 && live === 0) next.add(key)
        else if (before === 0 && live > 0) next.delete(key)
      }
      return { hidden: next, counts: nextCounts }
    }

    /** Workspace id that owns the currently selected Session, if any. */
    function currentWorkspaceKey(workspaces, sessions) {
      const items = Array.isArray(workspaces?.items) ? workspaces.items : []
      const byId = sessions?.byId ?? {}
      let currentId
      for (const session of Object.values(byId)) {
        if (((session?.retainedBy?.mainView) ?? 0) > 0) {
          currentId = session.id
          break
        }
      }
      if (currentId === undefined) return undefined
      return items.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(currentId))?.workspaceId
    }

    /** Hidden set as rendered: the Workspace in use always stays visible. */
    function effectiveHiddenSet(hidden, currentKey) {
      const next = new Set(asSet(hidden))
      if (currentKey !== undefined) next.delete(currentKey)
      return next
    }

    /** Toggle `display` on the shipped Workspace rows so they match `hidden`. */
    function applyRowVisibility(hidden, root) {
      const scope = root ?? document
      const selector = '[data-row-key^="' + WORKSPACE_ROW_PREFIX + '"]'
      for (const row of scope.querySelectorAll(selector)) {
        const key = (row.getAttribute('data-row-key') ?? '').slice(WORKSPACE_ROW_PREFIX.length)
        row.style.display = hidden.has(key) ? 'none' : ''
      }
    }

    function sameSet(left, right) {
      if (left.size !== right.size) return false
      for (const value of left) if (!right.has(value)) return false
      return true
    }

    function loadHidden() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw === null) return new Set()
        const parsed = JSON.parse(raw)
        return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string' && value !== '') : [])
      } catch (error) {
        return new Set()
      }
    }

    function persistHidden(hidden) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...hidden]))
      } catch (error) { /* storage unavailable: keep the in-memory set only */ }
    }

    const MENU_STYLE = {
      position: 'fixed',
      zIndex: 1000,
      minWidth: '150px',
      padding: '4px',
      border: '1px solid var(--dsw-alias-border-l3, #d9d9d9)',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      background: 'var(--dsw-alias-bg-elevated, #ffffff)',
      color: 'var(--dsw-alias-label-primary, #1a1a1a)',
      boxShadow: '0 6px 20px rgba(0, 0, 0, 0.14)',
    }
    const MENU_ITEM_STYLE = {
      display: 'block',
      width: '100%',
      padding: '6px 10px',
      border: 'none',
      borderRadius: 'var(--dsw-radius-sm, 6px)',
      background: 'transparent',
      color: 'inherit',
      fontSize: '13px',
      lineHeight: '18px',
      textAlign: 'left',
      cursor: 'pointer',
    }
    const FOOT_STYLE = { padding: '4px 8px', fontSize: '12px', lineHeight: '18px' }
    const PANEL_STYLE = {
      position: 'absolute',
      bottom: '100%',
      left: '8px',
      right: '8px',
      maxHeight: '260px',
      overflowY: 'auto',
      padding: '4px',
      border: '1px solid var(--dsw-alias-border-l3, #d9d9d9)',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      background: 'var(--dsw-alias-bg-elevated, #ffffff)',
      color: 'var(--dsw-alias-label-primary, #1a1a1a)',
      boxShadow: '0 6px 20px rgba(0, 0, 0, 0.14)',
    }

    /**
     * Slot component: owns the visible/hidden state, the row sync, the
     * right-click hide menu and the hidden-workspace restore entry.
     */
    function WorkspaceHider(props) {
      const useWorkspaces = typeof props.useWorkspaces === 'function' ? props.useWorkspaces : () => undefined
      const useSessions = typeof props.useSessions === 'function' ? props.useSessions : () => undefined
      const items = useWorkspaces((state) => state.items)
      const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds)
      const byId = useSessions((state) => state.byId)

      const [hidden, setHidden] = React.useState(() => loadHidden())
      const [menu, setMenu] = React.useState(null)
      const [panelOpen, setPanelOpen] = React.useState(false)
      const hiddenRef = React.useRef(hidden)
      hiddenRef.current = hidden
      const prevCountsRef = React.useRef(undefined)

      const workspaces = React.useMemo(() => ({ items }), [items])
      const sessions = React.useMemo(() => ({ byId }), [byId])
      const counts = React.useMemo(
        () => liveSessionCounts(workspaces, sessions, archivedSessionIds),
        [workspaces, sessions, archivedSessionIds],
      )

      React.useEffect(() => {
        const result = stepHidden(prevCountsRef.current, counts, hiddenRef.current)
        prevCountsRef.current = result.counts
        if (sameSet(result.hidden, hiddenRef.current)) return
        setHidden(result.hidden)
        persistHidden(result.hidden)
      }, [counts])

      const currentKey = React.useMemo(() => currentWorkspaceKey(workspaces, sessions), [workspaces, sessions])
      const effective = React.useMemo(() => effectiveHiddenSet(hidden, currentKey), [hidden, currentKey])

      React.useEffect(() => {
        let frame = 0
        const sync = () => {
          frame = 0
          applyRowVisibility(effective)
        }
        const schedule = () => {
          if (frame === 0) frame = requestAnimationFrame(sync)
        }
        sync()
        const observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true, subtree: true })
        return () => {
          observer.disconnect()
          if (frame !== 0) cancelAnimationFrame(frame)
        }
      }, [effective])

      React.useEffect(() => {
        const onContextMenu = (event) => {
          const row = event.target?.closest?.('[data-row-key^="' + WORKSPACE_ROW_PREFIX + '"]')
          if (!row) {
            setMenu(null)
            return
          }
          const key = (row.getAttribute('data-row-key') ?? '').slice(WORKSPACE_ROW_PREFIX.length)
          if (key === '') return
          event.preventDefault()
          setMenu({ key, x: event.clientX, y: event.clientY })
        }
        const onPointerDown = () => setMenu(null)
        document.addEventListener('contextmenu', onContextMenu, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('contextmenu', onContextMenu, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [])

      const hide = (key) => {
        const next = new Set(hiddenRef.current)
        next.add(key)
        setHidden(next)
        persistHidden(next)
      }
      const restore = (key) => {
        const next = new Set(hiddenRef.current)
        next.delete(key)
        setHidden(next)
        persistHidden(next)
      }

      const hiddenItems = React.useMemo(
        () => (Array.isArray(items) ? items : []).filter((item) => hidden.has(item.workspaceId)),
        [items, hidden],
      )

      const children = []
      if (menu !== null) {
        children.push(React.createElement('div', {
          key: 'menu',
          style: { ...MENU_STYLE, left: menu.x + 'px', top: menu.y + 'px' },
        }, React.createElement('button', {
          type: 'button',
          style: MENU_ITEM_STYLE,
          onClick: () => {
            hide(menu.key)
            setMenu(null)
          },
        }, '隐藏工作区')))
      }
      if (hiddenItems.length > 0) {
        const label = panelOpen ? '收起已隐藏' : '已隐藏 ' + hiddenItems.length
        children.push(React.createElement('div', {
          key: 'foot',
          style: { ...FOOT_STYLE, position: 'relative' },
        },
        React.createElement('button', {
          type: 'button',
          style: { ...MENU_ITEM_STYLE, color: 'var(--dsw-alias-label-secondary, #666)' },
          onClick: () => setPanelOpen((open) => !open),
        }, label),
        panelOpen && React.createElement('div', { style: PANEL_STYLE }, hiddenItems.map((item) => React.createElement(
          'button',
          {
            key: item.workspaceId,
            type: 'button',
            style: MENU_ITEM_STYLE,
            title: item.path,
            onClick: () => restore(item.workspaceId),
          },
          '恢复 ' + (item.title ?? item.workspaceId),
        )))))
      }
      return children.length === 0 ? null : React.createElement(React.Fragment, null, children)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'hide-empty-workspace',
          order: 1000,
        }, WorkspaceHider)), 'hide-empty-workspace: workspace hider')
      },
      internals: {
        liveSessionCounts,
        stepHidden,
        currentWorkspaceKey,
        effectiveHiddenSet,
        applyRowVisibility,
      },
    }
  },
})
