# dsh-hide-empty-workspace

侧边栏工作区在**最后一个未归档会话被归档的那一刻**自动隐藏，另提供右键手动隐藏与恢复入口。

## 行为

- **新增工作区不会被隐藏**：刚添加的工作区没有会话，仍然显示（这正是本插件不做「无会话即隐藏」的原因）。
- **自动隐藏**：某工作区的未归档会话数从 `1+` 掉到 `0`（最后一个会话被归档）时，该工作区的侧栏行隐藏。
- **自动恢复**：该工作区重新出现未归档会话（`0 -> 1+`）时，自动取消隐藏。
- **手动隐藏**：在侧栏任意工作区行上右键 →「隐藏工作区」，任何情况下都立即隐藏。
- **恢复入口**：侧栏底部出现「已隐藏 N」按钮，展开后逐个「恢复 &lt;标题&gt;」。
- **当前工作区例外**：正在使用的工作区即使满足隐藏条件也保持可见。
- 「未分组」桶永不隐藏。
- 只切换侧栏行元素的 `display`，不归档、不删除、不改写任何工作区注册与会话数据。

## 原理

官方侧栏浏览器为每个工作区渲染一行 `[data-row-key="workspace:<workspaceId>"]`，会话行是 `[data-row-key="session:<sessionId>"]`。

- `index.js`：宿主半边，占位。
- `client.js`：浏览器半边。向 `sidebar.footer.action`（list 槽位）注册一个组件，通过标准根钩子 `useWorkspaces` / `useSessions` 读取工作区与会话快照：
  - `liveSessionCounts` 直接按 `workspace.sessionIds` 减去 `archivedSessionIds` 计数。**不要**再要求会话出现在 `useSessions().byId` 快照里——该快照不保证包含全部会话，用存在性判断会让计数恒为 0，自动隐藏永远不触发（实测踩过）。
  - `stepHidden` 只在跨快照的计数转变上动作：首次见到的工作区只记录、不隐藏；`1+ -> 0` 隐藏；`0 -> 1+` 恢复。
  - `applyRowVisibility` 对官方行设置 `display: none`，`MutationObserver` 在官方重渲染后重新对齐。
  - 隐藏集合持久化在 `localStorage['dsh-hide-empty-workspace.hidden.v1']`。

## 安装（DSH Desktop）

```sh
DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness" \
  "$HOME/Library/Application Support/dsh-desktop/harness/.desktop-bin/node" \
  "/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  plugin --profile web add /Users/<you>/dsh-hide-empty-workspace
```

`patchReload: live` 的 profile 装完刷新页面即生效（宿主行即时挂载，客户端半边在页面重新加载后生效）。

## 开发与验证

```sh
node --test tests/hidden-workspaces.test.mjs          # 12 条纯函数单测
DSH_BIN=<dsh-wrapper> DSH_HOME=<home> \
  node <create-dsh-plugin>/scripts/verify-dsh-plugin.mjs --plugin-dir .   # G1-G5 组合与激活梯子
```

客户端半边必须另做浏览器验证（verify 梯子证明不了渲染）。已验证的做法：用本机 headless Chrome + CDP，先从 `<home>/.credentials.yaml` 的 `client-connection/browser-session` secret 签一个浏览器会话 cookie 注入页面，再查询 `[data-row-key]` 的 `display`；侧栏可能停在收起（rail）态，要先点 `aria-label="打开侧边栏"` 再用 DOM。

## 已知边界

- 依赖官方侧栏的行标记 `data-row-key`；官方若改动该属性，插件会静默不生效。
- 侧栏收起（rail）时组件不挂载；期间在别处归档最后一个会话不会被捕捉，展开后可右键手动隐藏。
- 与同样接管 `sidebar.workspaces` 的插件（例如 dsh-worksop-plus、dsh-better-workspace）同时启用时，行标记由对方决定，本插件可能失效。
