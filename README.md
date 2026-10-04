<sub>🌐 <b>中文</b> · <a href="README.en.md">English</a></sub>

<div align="center">

# dsh-hide-empty-workspace

> *「把最后一个会话归档的那一刻，那个空工作区自己从侧栏消失了。」*

![DSH plugin](https://img.shields.io/badge/DSH-plugin-blueviolet)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![no data writes](https://img.shields.io/badge/archive%20%C2%B7%20delete%20%C2%B7%20rewrite-none-brightgreen)

**侧栏的自动瘦身。它只在这条规则成立时动手：某个工作区的未归档会话从 `1+` 掉到 `0`。它不归档、不删除、不改写工作区注册，唯一会写的是浏览器里的隐藏集合。**

[它解决什么问题](#它解决什么问题) · [效果示例](#效果示例) · [快速开始](#快速开始) · [触发方式](#触发方式) · [它和同类有什么不同](#它和同类有什么不同) · [安全边界](#安全边界) · [文件结构](#文件结构) · [验证与测试](#验证与测试)

</div>

---

## 它解决什么问题

归档是 DSH 里一个**手动动作**，而「这个工作区已经空了」没有人替你判断。

于是侧栏总是这样烂掉：你随手给某个项目开过一两次会话，用过就归档掉，可那个工作区还留在列表里——没有会话，也不再有用，只是在那里占一行。攒到十几个之后，真正在用的那几个被挤到了下面。

这个插件把「空了」变成一个**被动触发的清理信号**：某工作区的未归档会话数从 `1+` 掉到 `0` 的那一刻，它的侧栏行自动隐藏。

**它只在那一刻动手。** 手动隐藏在任一工作区行自己的「…」菜单里；恢复入口在侧栏底部。插件不接管任何状态。

## 效果示例

![工作区行菜单里的「隐藏工作区」、底部「已隐藏 N」入口与官方恢复对话框](assets/showcase/hide-empty-workspace.gif)

上图是侧栏一列的截图，工作区名已隐去。每一帧都由 `npm run verify:browser` 在真实实例上产出（DSH Desktop，2026-10-02，24 个工作区）。

同一场验收的实测读数（2026-10-02，当次脚本 14 条断言）：

```text
PASS  signed browser session accepted at http://127.0.0.1:43129 (no 401)
PASS  shipped sidebar still renders 24 workspace row(s) with data-row-key="workspace:<id>"
PASS  no marker-mismatch banner: the row contract holds and the self-check stays quiet
PASS  the shipped Workspace row menu carries the 「隐藏工作区」 entry
PASS  a real mouse press/release on the entry ran the action
PASS  the appended entry closes the shipped menu it lives in
PASS  「隐藏工作区」 recorded both workspaces in localStorage: 9a1f4aca-…, eb5f9d32-…
PASS  display:none actually reached the shipped rows (1 hidden, 1 kept as the workspace in use)
PASS  sidebar footer shows 「已隐藏 2」
PASS  the 「已隐藏 N」 entry opened the shipped modal (role=dialog, aria-label 「已隐藏的工作区」)
PASS  the modal lists one 「恢复」 action per hidden workspace (2)
PASS  the modal closed itself once the last workspace was restored
PASS  restore returned the hidden set to its original value: (empty)
PASS  no workspace row is left hidden (0)
14 passed, 0 failed
```

`display:none` 那一行是一次**实测**确认：连着隐藏两个工作区，只有一个变成 `display:none`，另一个是「正在使用的工作区」——它按设计保持可见。

## 快速开始

```sh
# 直接从 GitHub 装（最短，不需要 npm 账号）
dsh plugin --profile web add https://codeload.github.com/d0ublecl1ck/dsh-hide-empty-workspace/tar.gz/refs/heads/main

# 本地改代码时，把它以路径形式加进 profile
dsh plugin --profile web add /绝对路径/dsh-hide-empty-workspace
```

`dsh plugin add` 会在 profile 目录里同时写入 `dependencies` 与 `dsh.profile.bundles` 两处，装完刷新页面即可。

<details>
<summary>DSH Desktop 里没有 <code>dsh</code> 命令时</summary>

Desktop 自带一份运行时，直接用它可以跳过 PATH：

```sh
DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness" \
  "$DSH_HOME/.desktop-bin/node" \
  "/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  plugin --profile web add /绝对路径/dsh-hide-empty-workspace
```

Windows 上把路径换成本机对应位置即可，参数不变。
</details>

## 触发方式

- **自动**：你把某个工作区的最后一个未归档会话归档掉 → 它的行隐藏。
- **手动**：悬停任意工作区行，点行内「…」菜单里的「隐藏工作区」。任何情况下都立即隐藏。
- **恢复**：点侧栏底部的「已隐藏 N」→ 打开官方对话框 → 逐个「恢复」，恢复完自动关闭。
- **自动恢复**：某个被隐藏的工作区重新有了未归档会话 → 自动取消隐藏。

不会触发的情况：

- **刚添加的工作区**：新工作区没有会话，但它是「首次见到」的，只被记录、不被隐藏。这是本插件不做「无会话即隐藏」的直接原因。
- **正在使用的工作区**：即使满足隐藏条件也保持可见（上面 `display:none` 那条断言实测到的就是它）。
- **「未分组」桶**：永不隐藏。

## 它和同类有什么不同

| | 它怎么做 | 与本插件的差别 |
|---|---|---|
| [SUZUNAMI/dsh-workspace-hide](https://github.com/SUZUNAMI/dsh-workspace-hide) | 设置页逐个开关；隐藏时**连带归档**该工作区的会话 | 它要求你去设置页，且会写归档状态；本插件自动触发，且零数据写入 |
| [Robert-Wang-08/dsh-plugin-sidebar-visibility](https://github.com/Robert-Wang-08/dsh-plugin-sidebar-visibility) | 一个包七件事：隐藏、折叠、拖排、会话重命名/分叉/归档/收藏 | 它是功能集；本插件只做一件事，零配置 |
| [KannaKuron/dsh-better-workspace](https://github.com/KannaKuron/dsh-better-workspace) | 侧栏工作区两层文件夹树 | 它换掉整棵侧栏树；两者同时启用时行标记由对方决定，本插件会由自检横幅告诉你它已失效 |
| [0imzero/dsh-workspace-menu](https://github.com/0imzero/dsh-workspace-menu) | 首页工作区/会话右键菜单：置顶、重命名、归档、分叉 | 它是菜单，不含自动判断 |

## 安全边界

- **不归档、不取消归档、不删除**任何会话或工作区。
- **不改写工作区注册**：不动 `workspaces` 服务，不动 `settings.yaml`。
- **不联网**：插件不发任何请求。
- **唯一写入**是浏览器 `localStorage` 里的隐藏集合（键 `dsh-hide-empty-workspace.hidden.v1`）。清掉它，一切恢复原样。
- **不替换官方 UI**：只在官方已经渲染好的行上切 `display`，在工作区行自带的「…」菜单里追加一项，恢复入口用官方 `Modal`；不接管、不重绘官方组件。官方改版导致找不到行时，它不再默默无闻——侧栏底部会出现 `⚠ 工作区行标记失配，插件未生效`。

## 文件结构

```text
index.js                    宿主半边（本插件不需要宿主能力，占位 apply）
client.js                   浏览器半边：判定、行菜单项注入、官方 Modal 恢复入口、自检
cordis.patch.yml            bundle 层，声明插入本插件
tests/hidden-workspaces.test.mjs   25 条纯函数单测
scripts/verify-browser.mjs  真实浏览器验收 + 展示产物录制
scripts/check-release.mjs   离线发布门
assets/showcase/            由 verify-browser 产出的截图与 GIF
screenshots.json            给插件市场/目录站的展示截图清单
AGENTS.md                   给下一次会话的边界与命令
.freak                      待核查线索：对标观察 + 未验证清单
```

## 验证与测试

```sh
npm test                  # 25 条纯函数单测
npm run verify:browser    # 真实浏览器验收，需要实例在跑（15 条断言）
npm run check-release     # 发布门：清单、入口、模块 id、platform seed、版本一致性
npm run verify            # test + check-release
```

`npm run verify:browser` 自己完成整套认证与取证：读 `$DSH_HOME/.credentials.yaml` 里的 `client-connection/browser-session` secret，按 `v1.<payload>.<hmac>` 规则签一个浏览器会话 cookie，用 CDP 注入后打开实例，逐条断言并留截图；`--gif` 另出演示动图。录制默认对侧栏文字做隐私处理并裁到侧栏一列（`--no-redact` 关闭）。它会在验收过程中隐藏两个工作区，然后**把恢复也作为断言的一部分**，确保不留痕迹。

单测覆盖不到「slot 到底挂没挂上」，所以任何「插件有效」的结论都必须附 `verify:browser` 的实测输出。
