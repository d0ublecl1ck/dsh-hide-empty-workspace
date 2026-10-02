# dsh-hide-empty-workspace

DSH Web 插件：最后一个未归档会话被归档的瞬间，自动隐藏该工作区在侧边栏的行；另在工作区行自带的「…」菜单里追加「隐藏工作区」，并配侧栏底部恢复入口。只切 `display`，不归档、不删除、不改写工作区注册与会话数据。

## 怎么跑

- 开发：`npm test`（19 条纯函数单测），`npm run verify:browser`（真实浏览器验收，需要实例在跑），`npm run check-release`（发布门）。
- 装进实例：把本目录以 `link:` 或路径形式加进 profile 的 `dependencies` 与 `dsh.profile.bundles` 两处，然后刷新页面。客户端半边只改文件即生效（symlink），宿主半边改动要 `remove` + `add`。
- 本仓库**没有构建步骤**：`client.js` / `index.js` 就是交付产物，改完不必 build。

## 技术栈

- 纯 ESM + 手写 `window.__ModuleLoader__` 工厂，零运行时依赖、零构建。
- 客户端只从 shell 的 platform seed 里 `require('react')`；其余官方形状（`useWorkspaces` / `useSessions` / `sidebar.footer.action`）都用结构化方式描述，不做类型校验。
- 测试：`node --test`，把假 `ModuleLoader` 挂上 `client.js` 后取 `internals` 测纯函数。

## 验证资产（明文规矩）

- **改 `client.js` 的任何判定逻辑前先跑 `npm test`**；新增失败模式必须先在 `tests/` 写出会失败的用例。
- **声称「插件有效」必须附 `npm run verify:browser` 的实测输出**，不能只引单测：单测证明不了 slot 有没有挂上。
- **面向用户的文案（告警、菜单、恢复入口）只允许在 `client.js` 里出现一处**，测试用 `markerWarningText` 这类函数把它钉住。
- **验收脚本里的用户手势必须走真实指针序列**（CDP `Input.dispatchMouseEvent`：移动 → 按下 → 抬起），**MUST NOT** 用 `element.click()` 代替：合成 click 不经过 `pointerdown`，会漏掉「菜单在 pointerdown 阶段自毁」这类失效。2026-10-02 实测踩过——右键菜单版在被点的一瞬间就被 pointerdown 卸掉，真实鼠标点了没反应，而 `element.click()` 一直全绿。
- **截图类产物必须经 `--redact` 产出**（默认开启）；`--no-redact` 只在本地自查时用，不得入库。
- 发布动作（建仓库、push、打 tag、npm publish、投稿目录）每一步单独授权，不合并成一次「发一下」。

## 不变量

- 客户端模块的 `id` 必须等于包名 `dsh-hide-empty-workspace`。
- 自动隐藏只在**跨快照的 `1+ -> 0` 转变**上触发；首次见到的工作区只记录、不隐藏。
- `localStorage` 键固定为 `dsh-hide-empty-workspace.hidden.v1`。
- 正在使用的工作区（`retainedBy.mainView > 0` 所属）与「未分组」桶永不隐藏。
- **本插件不做任何状态写操作**：不归档、不取消归档、不删除工作区、不联网；唯一写入是 `localStorage` 里的隐藏集合。
- 隐藏入口只**追加**到官方工作区行菜单末尾：官方没有工作区行 action 的 slot，所以走 DOM 追加，并从当前打开的菜单克隆菜单项 class；不替换、不重绘任何官方组件。

## 当前状态与下一步

- 已实现（0.2.0，0.3.0 调整手动隐藏入口）：自动隐藏、工作区行菜单里的手动隐藏、恢复入口、当前工作区例外、行标记失配自检、发布元数据与发布门。0.3.0 把手动隐藏从插件自建的右键菜单改挂到官方工作区行菜单；右键入口一并移除。
- 已验证：`npm test` 19/19；`npm run verify:browser` 11 条断言全过（2026-10-02，DSH Desktop，24 个工作区）——含「官方行菜单里出现隐藏入口」「真实鼠标按下/抬起后动作生效」「追加项关闭官方菜单」「隐藏落到 localStorage 且 display:none 生效」「恢复后集合与可见性回到原样」。反向对照做过一次：给菜单项临时加回 `pointerdown` 自毁，脚本立刻报 `only 0/2 hides were persisted` 并退出码 1。
- 未验证：侧栏收成 rail 时组件不挂载，该形态下的行为未在真实浏览器确认；与 `dsh-better-workspace` 等接管侧栏的插件同时启用时的表现未实测（详见 `.freak`）。
- 下一步：awesome-dsh-plugin 投稿已提（[PR #6376](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6376)，2026-10-02），等年龄门自动放行与 review；未做且需按需授权的是 npm 发布、CI、rail 形态验收。
