/**
 * Browser half: hide a sidebar Workspace group only at the moment its last
 * live (non-archived) Session disappears, plus a manual "hide this workspace"
 * entry appended to the Workspace row's own "..." action menu.
 *
 * Rationale: hiding on "has no live session" alone would hide a Workspace the
 * instant it is added (a fresh Workspace starts with zero Sessions). Instead the
 * automatic rule fires only on the 1 -> 0 transition of the live-Session count,
 * so a newly added Workspace stays visible until the user archives its last
 * Session. Manual hides are remembered until the user restores them or until a
 * live Session appears again.
 *
 * The shipped sidebar renders one `[data-row-key="workspace:<id>"]` row per
 * Workspace, and its row menu is NOT a slot: there is no extension point for a
 * Workspace-row action, so this plugin appends one entry to that menu's DOM
 * instead (cloning the shipped item classes, so no hashed class name is
 * hardcoded). The menu is a portal directly under `document.body`.
 *
 * Closing that menu is the plugin's job too: the entry was not rendered by the
 * menu's own React tree, so it cannot use the menu's `useMenuOpenState` hook.
 * It dispatches the same Escape keydown the shipped menu already listens for.
 *
 * Self-inflicted failure this design removes: an earlier version opened a
 * plugin-owned context menu on `contextmenu` and dismissed it on any
 * `pointerdown`. A real mouse click therefore dismissed the menu on
 * pointerdown and the following `click` never reached the (already unmounted)
 * entry, so "hide this workspace" did nothing. Programmatic `element.click()`
 * never emits pointerdown, which is why the old browser check stayed green.
 */
window.__ModuleLoader__.load({
  id: 'dsh-hide-empty-workspace',
  factory(require) {
    const React = require('react')
    const { Button, Modal } = require('@deepseek-ai/dsh-client-ui-primitives')

    const WORKSPACE_ROW_PREFIX = 'workspace:'
    const WORKSPACE_ROW_SELECTOR = '[data-row-key^="' + WORKSPACE_ROW_PREFIX + '"]'
    const ANY_ROW_SELECTOR = '[data-row-key]'
    const ROW_KEY_ATTRIBUTE = 'data-row-key'
    const SHIPPED_MENU_SELECTOR = '[role="menu"]'
    const SHIPPED_MENU_ITEM_SELECTOR = '[role="menuitem"]'
    /** Frame marker the layout sets while the sidebar is collapsed into its rail. */
    const COLLAPSED_FRAME_SELECTOR = '[data-sidebar-collapsed]'
    /** Class the single-list body carries; that grouping never renders a Workspace row. */
    const FLAT_LIST_SELECTOR = '[class*="flatList"]'
    /** Marks our appended entry so re-injection after a React re-render is a no-op. */
    const MENU_ITEM_FLAG = 'data-dsh-hew-menu-item'
    const STORAGE_KEY = 'dsh-hide-empty-workspace.hidden.v1'
    /** Grace period before the row-marker self-check runs, so a slow first paint is not read as a failure. */
    const MARKER_CHECK_DELAY_MS = 1500
    /**
     * How long a Workspace-row click keeps the appended entry armed.
     *
     * The row's own menu mounts inside the click that opens it, so this only has
     * to cover one render. It exists to end the gesture: menus that open later
     * without a click (the composer's `/` and `@` menus, for instance) must not
     * inherit an arm nobody is waiting for any more.
     */
    const MENU_ARM_TIMEOUT_MS = 1000

    /** Eye-off glyph for the appended menu entry; static markup, no user input. */
    const HIDE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" stroke-width="1">'
      + '<path d="M1.7 8C3.2 5.4 5.4 4 8 4C10.6 4 12.8 5.4 14.3 8C12.8 10.6 10.6 12 8 12C5.4 12 3.2 10.6 1.7 8Z" stroke="currentColor"/>'
      + '<path d="M6.2 8C6.2 8.99 7.01 9.8 8 9.8C8.99 9.8 9.8 8.99 9.8 8C9.8 7.01 8.99 6.2 8 6.2C7.01 6.2 6.2 7.01 6.2 8Z" stroke="currentColor"/>'
      + '<path d="M2.5 13.5L13.5 2.5" stroke="currentColor"/>'
      + '</svg>'

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

    /**
     * Workspace id carried by a `data-row-key` value, or `undefined` for any
     * other row (Session rows, the Ungrouped bucket, malformed markers).
     */
    function workspaceKeyFromRowKey(rowKey) {
      if (typeof rowKey !== 'string' || !rowKey.startsWith(WORKSPACE_ROW_PREFIX)) return undefined
      const key = rowKey.slice(WORKSPACE_ROW_PREFIX.length)
      return key === '' ? undefined : key
    }

    /**
     * Workspace id of the row that owns the clicked element, if any.
     *
     * Workspace rows do not nest other rows, so the nearest `[data-row-key]`
     * is the only row that can own the click; a Session-row click resolves to
     * a `session:` key and is therefore ignored.
     */
    function workspaceKeyFromTarget(target) {
      const row = target?.closest?.(ANY_ROW_SELECTOR)
      return workspaceKeyFromRowKey(row?.getAttribute?.(ROW_KEY_ATTRIBUTE))
    }

    /**
     * Menu arming state machine behind the appended Workspace-row entry.
     *
     * The entry is not part of the menu's React tree, so the only link between
     * "this row was clicked" and "this menu opened" is time. Arming must not
     * outlive that gesture: the shipped row menu is not the only
     * `[role="menu"]` in the app — the model picker, filters and other popovers
     * open portals too — and an arm that survives them appends the entry into
     * whatever menu opens next. 0.4.0 shipped exactly that failure: a row click
     * armed the key for the rest of the page's life, so the next popover that
     * opened (the model picker) received a stray 「隐藏工作区」 row.
     *
     * @param armedKey - Workspace key armed before this interaction.
     * @param action - `{ type: 'click', key }` for a document click, where `key`
     * is the Workspace row under it (`undefined` outside every row),
     * `{ type: 'injected' }` once the entry has been appended to an open menu,
     * or `{ type: 'expired' }` when the arm outlived `MENU_ARM_TIMEOUT_MS`.
     * @returns the Workspace key the next opened menu may receive the entry for,
     * or `null` when nothing is armed.
     */
    function stepMenuArm(armedKey, action) {
      if (action?.type === 'injected' || action?.type === 'expired') return null
      if (action?.type !== 'click') return armedKey
      const clicked = action.key
      return typeof clicked === 'string' && clicked !== '' ? clicked : null
    }

    /** Toggle `display` on the shipped Workspace rows so they match `hidden`. */
    function applyRowVisibility(hidden, root) {
      const scope = root ?? document
      for (const row of scope.querySelectorAll(WORKSPACE_ROW_SELECTOR)) {
        const key = workspaceKeyFromRowKey(row.getAttribute(ROW_KEY_ATTRIBUTE))
        row.style.display = key !== undefined && hidden.has(key) ? 'none' : ''
      }
    }

    /** How many shipped Workspace rows the current DOM exposes. */
    function countWorkspaceRows(root) {
      const scope = root ?? document
      return scope.querySelectorAll(WORKSPACE_ROW_SELECTOR).length
    }

    /**
     * Whether the shipped sidebar is in a state that renders Workspace rows.
     *
     * Two shipped states render none, and neither is the silent failure the
     * self-check exists to catch:
     * - the column is collapsed into its rail (`wide === false`, or the frame
     *   carries `data-sidebar-collapsed`), so the whole browsing tree unmounts;
     * - the browser is in the single-list grouping (`groupBy: "flat"`), whose
     *   body renders one flat Session list and never a Workspace row.
     *
     * The rail flag is read from the shell prop and the DOM both, because the
     * frame attribute is what the layout actually commits; the single-list body
     * exists only in the DOM.
     *
     * @param wide - `wide` flag the sidebar shell hands its slots.
     * @param root - scope to probe; defaults to `document`.
     * @returns `false` only in a state where Workspace rows cannot appear.
     */
    function workspaceRowsRendered(wide, root) {
      if (wide === false) return false
      const scope = root ?? document
      if (scope.querySelector(COLLAPSED_FRAME_SELECTOR) !== null) return false
      if (scope.querySelector(FLAT_LIST_SELECTOR) !== null) return false
      return true
    }

    /**
     * Silent-failure probe. Everything here hangs off the shipped row marker, so
     * "workspaces exist but not a single Workspace row is in the DOM" means the
     * sidebar was renamed, replaced, or taken over by another plugin: this
     * plugin has become a no-op and the user would otherwise never be told.
     *
     * Only the zero-row case counts. A long list may be virtualised, so a
     * partial count is not evidence of anything. A sidebar state that renders no
     * Workspace row by design (`workspaceRowsRendered` is false) is not a
     * mismatch either, so it stays quiet.
     *
     * @param workspaceCount - Workspaces the snapshot knows about.
     * @param matchedRowCount - Workspace rows the DOM exposes.
     * @param rowsRendered - `workspaceRowsRendered(...)`, or `undefined` to treat
     *   Workspace rows as expected.
     * @returns `null` when healthy, otherwise the mismatch to report.
     */
    function diagnoseRowMarkers(workspaceCount, matchedRowCount, rowsRendered) {
      const expected = Number.isFinite(workspaceCount) ? workspaceCount : 0
      if (expected <= 0) return null
      if (Number(matchedRowCount) > 0) return null
      if (rowsRendered === false) return null
      return { workspaceCount: expected, matchedRowCount: 0 }
    }

    /** Footer copy for a marker mismatch. Kept in one place so tests can pin it. */
    function markerWarningText() {
      return '⚠ 工作区行标记失配，插件未生效'
    }

    function markerWarningDetail(workspaceCount) {
      return '当前有 ' + workspaceCount + ' 个工作区，但页面里找不到任何 [data-row-key^="workspace:"] 行。'
        + '通常是 DSH 侧栏改版，或另一个接管侧栏的插件所致；自动隐藏、行菜单隐藏与恢复入口都不会生效。'
    }

    /** Label of the entry this plugin appends to the shipped Workspace row menu. */
    function hideMenuItemText() {
      return '隐藏工作区'
    }

    /** Copy for the shipped-Modal restore dialog. Kept in one place so tests can pin it. */
    function restoreDialogText() {
      return {
        title: '已隐藏的工作区',
        description: '这些工作区已从侧栏隐藏，恢复后重新显示。',
        restore: '恢复',
        close: '关闭',
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

    /**
     * Build the menu entry, cloning the shipped item's classes from the menu
     * that is currently open. Nothing here hardcodes a hashed CSS-module name,
     * so a restyle keeps the entry looking native.
     */
    function buildHideMenuItem(scope, workspaceKey, onHide) {
      const doc = scope ?? document
      const sampleItem = doc.querySelector(SHIPPED_MENU_ITEM_SELECTOR)
      const sampleWrap = sampleItem?.parentElement ?? null
      const wrap = doc.createElement('div')
      if (sampleWrap?.className) wrap.className = sampleWrap.className
      wrap.setAttribute(MENU_ITEM_FLAG, workspaceKey)

      const button = doc.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      if (sampleItem?.className) button.className = sampleItem.className

      const iconSlot = sampleItem?.querySelector('span')
      const icon = doc.createElement('span')
      if (iconSlot?.className) icon.className = iconSlot.className
      icon.innerHTML = HIDE_ICON_SVG

      const labelSlot = sampleItem?.querySelector('span:last-child')
      const label = doc.createElement('span')
      if (labelSlot?.className) label.className = labelSlot.className
      label.textContent = hideMenuItemText()

      button.appendChild(icon)
      button.appendChild(label)
      button.addEventListener('click', (event) => {
        event.preventDefault()
        onHide(workspaceKey)
      })
      wrap.appendChild(button)
      return wrap
    }

    /**
     * Append the hide entry to the shipped Workspace row menu when one is open.
     * Returns `false` while no menu is in the DOM, so the caller keeps waiting.
     */
    function injectHideMenuItem(scope, workspaceKey, onHide) {
      const doc = scope ?? document
      const menu = doc.querySelector(SHIPPED_MENU_SELECTOR)
      if (menu === null) return false
      if (menu.querySelector('[' + MENU_ITEM_FLAG + ']') !== null) return true
      const viewport = menu.querySelector('[class*="viewport"]') ?? menu
      viewport.appendChild(buildHideMenuItem(doc, workspaceKey, onHide))
      return true
    }

    /**
     * Close the shipped menu the way its own keyboard handling does. The entry
     * lives outside the menu's React tree, so it cannot use `useMenuOpenState`;
     * Escape is the same signal a keyboard user would send.
     */
    function closeShippedMenu(scope) {
      const doc = scope ?? document
      if (typeof doc.defaultView?.KeyboardEvent !== 'function' && typeof KeyboardEvent !== 'function') return
      const KeyboardEventCtor = doc.defaultView?.KeyboardEvent ?? KeyboardEvent
      const target = doc.activeElement ?? doc.body
      if (!target) return
      target.dispatchEvent(new KeyboardEventCtor('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      }))
    }

    const ENTRY_BUTTON_STYLE = {
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
    const WARNING_STYLE = {
      padding: '4px 8px',
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-warning, #d48806)',
    }

    /**
     * Slot component: owns the visible/hidden state, the row sync, the entry
     * appended to the shipped Workspace row menu, and the hidden-workspace
     * restore entry.
     */
    function WorkspaceHider(props) {
      const useWorkspaces = typeof props.useWorkspaces === 'function' ? props.useWorkspaces : () => undefined
      const useSessions = typeof props.useSessions === 'function' ? props.useSessions : () => undefined
      const items = useWorkspaces((state) => state.items)
      const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds)
      const byId = useSessions((state) => state.byId)

      const [hidden, setHidden] = React.useState(() => loadHidden())
      const [restoreOpen, setRestoreOpen] = React.useState(false)
      const [markerWarning, setMarkerWarning] = React.useState(null)
      const hiddenRef = React.useRef(hidden)
      hiddenRef.current = hidden
      const prevCountsRef = React.useRef(undefined)
      const hideRef = React.useRef(() => {})

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

      // Self-check: if the shipped row marker is gone, say so instead of doing nothing.
      React.useEffect(() => {
        const timer = setTimeout(() => {
          setMarkerWarning(diagnoseRowMarkers(
            Array.isArray(items) ? items.length : 0,
            countWorkspaceRows(),
            workspaceRowsRendered(props.wide),
          ))
        }, MARKER_CHECK_DELAY_MS)
        return () => clearTimeout(timer)
      }, [items, effective, props.wide])

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
      hideRef.current = hide

      // Remember which Workspace row was clicked, then append the hide entry to
      // whatever menu the shipped row button opens. The menu is a portal, so a
      // MutationObserver on body is the only reliable place to catch it. The arm
      // is decided by every click and consumed by the append itself, so a menu
      // that did not come from a Workspace row never receives the entry (see
      // `stepMenuArm`).
      React.useEffect(() => {
        let armedKey = null
        let armTimer = 0
        const arm = (key) => {
          armedKey = key
          if (armTimer !== 0) {
            clearTimeout(armTimer)
            armTimer = 0
          }
          if (armedKey === null) return
          armTimer = setTimeout(() => {
            armTimer = 0
            armedKey = stepMenuArm(armedKey, { type: 'expired' })
          }, MENU_ARM_TIMEOUT_MS)
        }
        const remember = (event) => {
          arm(stepMenuArm(armedKey, { type: 'click', key: workspaceKeyFromTarget(event.target) }))
        }
        const refresh = () => {
          if (armedKey === null) return
          const attached = injectHideMenuItem(document, armedKey, (key) => {
            hideRef.current(key)
            closeShippedMenu(document)
          })
          if (attached) arm(stepMenuArm(armedKey, { type: 'injected' }))
        }
        document.addEventListener('click', remember, true)
        const observer = new MutationObserver(refresh)
        observer.observe(document.body, { childList: true, subtree: true })
        return () => {
          document.removeEventListener('click', remember, true)
          observer.disconnect()
          if (armTimer !== 0) clearTimeout(armTimer)
        }
      }, [])

      const hiddenItems = React.useMemo(
        () => (Array.isArray(items) ? items : []).filter((item) => hidden.has(item.workspaceId)),
        [items, hidden],
      )

      // Restoring the last entry closes the dialog instead of leaving an empty one open.
      React.useEffect(() => {
        if (restoreOpen && hiddenItems.length === 0) setRestoreOpen(false)
      }, [restoreOpen, hiddenItems.length])

      const children = []
      if (markerWarning !== null) {
        children.push(React.createElement('div', {
          key: 'marker-warning',
          style: WARNING_STYLE,
          title: markerWarningDetail(markerWarning.workspaceCount),
        }, markerWarningText()))
      }
      if (hiddenItems.length > 0) {
        children.push(React.createElement('div', {
          key: 'foot',
          style: FOOT_STYLE,
        },
        React.createElement('button', {
          type: 'button',
          style: { ...ENTRY_BUTTON_STYLE, color: 'var(--dsw-alias-label-secondary, #666)' },
          onClick: () => setRestoreOpen(true),
        }, '已隐藏 ' + hiddenItems.length)))
      }
      if (restoreOpen || hiddenItems.length > 0) {
        const text = restoreDialogText()
        children.push(React.createElement(Modal, {
          key: 'restore-dialog',
          open: restoreOpen,
          onClose: () => setRestoreOpen(false),
          title: text.title,
          description: text.description,
          closeLabel: text.close,
          footer: React.createElement(Button, {
            variant: 'primary',
            onClick: () => setRestoreOpen(false),
          }, text.close),
        }, React.createElement('div', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '320px',
            overflowY: 'auto',
          },
        }, hiddenItems.map((item) => React.createElement('div', {
          key: item.workspaceId,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '6px 0',
          },
        },
        React.createElement('span', {
          title: item.path,
          style: {
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '14px',
            color: 'var(--dsw-alias-label-primary, #1a1a1a)',
          },
        }, item.title ?? item.workspaceId),
        React.createElement(Button, {
          variant: 'outline',
          size: 'sm',
          onClick: () => restore(item.workspaceId),
        }, text.restore))))))
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
        workspaceKeyFromRowKey,
        workspaceKeyFromTarget,
        stepMenuArm,
        hideMenuItemText,
        restoreDialogText,
        applyRowVisibility,
        countWorkspaceRows,
        workspaceRowsRendered,
        diagnoseRowMarkers,
        markerWarningText,
        markerWarningDetail,
      },
    }
  },
})
