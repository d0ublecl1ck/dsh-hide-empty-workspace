# dsh-hide-empty-workspace

DSH Web 插件：最后一个未归档会话被归档的瞬间，自动隐藏该工作区在侧边栏的行；另在工作区行自带的「…」菜单里追加「隐藏工作区」，并配侧栏底部恢复入口。只切 `display`，不归档、不删除、不改写工作区注册与会话数据。

## 怎么跑

- 开发：`npm test`（28 条纯函数单测），`npm run verify:browser`（真实浏览器验收，需要实例在跑；`--shots <目录>` 可把截图写到临时目录，别覆盖入库产物），`npm run check-release`（发布门）。
- 装进实例：把本目录以 `link:` 或路径形式加进 profile 的 `dependencies` 与 `dsh.profile.bundles` 两处，然后刷新页面。客户端半边改文件后**重载窗口**即生效（2026-10-07 实测：宿主按磁盘现读，boot 的 `client.js&rev=` 随内容变化；已打开的页面不会热替换），宿主半边改动要 `remove` + `add`。
- 本仓库**没有构建步骤**：`client.js` / `index.js` 就是交付产物，改完不必 build。

## 技术栈

- 纯 ESM + 手写 `window.__ModuleLoader__` 工厂，零运行时依赖、零构建。
- 客户端只从 shell 的 platform seed 里 `require('react')` 与 `@deepseek-ai/dsh-client-ui-primitives`（用官方 `Modal` / `Button`）；其余官方形状（`useWorkspaces` / `useSessions` / `sidebar.footer.action`）都用结构化方式描述，不做类型校验。
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
- **IF** 追加菜单项 **THEN** 它的「上膛」只能属于工作区行自己的那次点击：行外点击解除、追加成功消耗、1s 过期（`stepMenuArm` / `MENU_ARM_TIMEOUT_MS`）；**MUST NOT** 让模型选择器、`/`、`@` 等其它 `[role="menu"]` 拿到该项。
- 恢复入口必须是官方 `Modal`（`role="dialog"`，Esc / 遮罩点击 / 焦点归还都交给官方）；**MUST NOT** 再自绘底部展开面板。

## 同类对比（维护者口径）

README 只留使用者口径；这张表给维护者评估差异与失效风险。

| 竞品 | 它怎么做 | 与本插件的差别 |
|---|---|---|
| [SUZUNAMI/dsh-workspace-hide](https://github.com/SUZUNAMI/dsh-workspace-hide) | 设置页逐个开关；隐藏时**连带归档**该工作区的会话 | 它要求去设置页，且会写归档状态；本插件自动触发、零数据写入 |
| [Robert-Wang-08/dsh-plugin-sidebar-visibility](https://github.com/Robert-Wang-08/dsh-plugin-sidebar-visibility) | 一个包七件事：隐藏、折叠、拖排、会话重命名/分叉/归档/收藏 | 它是功能集；本插件只做一件事、零配置 |
| [KannaKuron/dsh-better-workspace](https://github.com/KannaKuron/dsh-better-workspace) | 侧栏工作区两层文件夹树 | 它换掉整棵侧栏树；同时启用时行标记由对方决定，本插件的自检会在应渲染工作区行的形态下报告失效（收起侧栏/单列表下本就不渲染，不报警） |
| [0imzero/dsh-workspace-menu](https://github.com/0imzero/dsh-workspace-menu) | 首页工作区/会话右键菜单：置顶、重命名、归档、分叉 | 它是菜单，不含自动判断 |

## 当前状态与下一步

- 已实现（0.2.0；0.3.0 调整手动隐藏入口；0.4.0 调整恢复入口；0.4.1 修掉菜单项上膛泄漏；0.4.2 收紧自检的模式判定；0.4.3 补 npm 安装入口与 CI）：自动隐藏、工作区行菜单里的手动隐藏、官方 Modal 里的逐个恢复、当前工作区例外、行标记失配自检、发布元数据与发布门。0.4.2 起自检只在「侧栏本就应渲染工作区行」时报警：收起侧栏（rail）与「单列表」分组保持安静。
- 已验证：`npm test` **28/28**（2026-10-07）；`npm run verify:browser` **17/17**（2026-10-07，DSH Desktop，新字节）——含「官方行菜单里出现隐藏入口」「真实鼠标按下/抬起后动作生效」「追加项关闭官方菜单」「模型选择器菜单里没有隐藏入口」「隐藏落到 localStorage 且 display:none 生效」「侧栏底部出现已隐藏 N」「收起侧栏（800×600）无横幅」「单列表无横幅」。同一脚本在旧字节上是 15/17，两条模式断言如期失败，证明它们能钉住本缺陷；反向对照：用 0.4.0 的 `client.js` 跑模型选择器断言 → `the model picker menu received a stray 「隐藏工作区」 entry (1)`。逐条断言见 `scripts/verify-browser.mjs` 头部与运行输出。
- 已消解：2026-10-04 记录的「验收脚本最后 4 条（官方 Modal、恢复动作、隐藏集合复位、行可见性复位）失败」在 2026-10-07 重跑全部通过，按过期处理。
- 已实测（2026-10-07，临时工作区 + headless Chrome）：rail 期间在别处归档最后一个会话会被捕捉（隐藏集合立刻写入该工作区）；放宽到宽栏后，仍会渲染的行被 MutationObserver 补判成 `display:none`（归档后空工作区本身在分组视图里就不渲染，补判是在仍有会话的行上验证的）。仍未验证：运行中在单列表与分组之间切换时自检不立即重判；与 `dsh-better-workspace` 等接管侧栏的插件同时启用时的表现（详见 `.freak`）。
- 下一步：npm 已发布（[npmjs](https://www.npmjs.com/package/dsh-hide-empty-workspace)，dist-tag `latest`，2026-10-07，已下载 tarball 核对过 `client.js`/版本）；CI 已加（`.github/workflows/ci.yml`）；market 走精选列表 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的 [PR #6376](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6376)，`Submission gate`/`check` 两条全绿、mergeable，等维护者 merge；未做且需按需授权的是打 tag。
