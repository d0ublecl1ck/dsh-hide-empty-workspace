# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的分节习惯，版本号遵循语义化版本。

## 0.2.0 — 2026-10-02

### 新增
- **行标记失配自检**：组件挂载 1.5s 后核对一次「有工作区，但页面里一行工作区行都没有」。命中时侧栏底部渲染 `⚠ 工作区行标记失配，插件未生效`，悬停给出原因。此前这种情况会让插件退化成彻底的空操作而用户毫不知情。
- **可重跑的浏览器验收**：`npm run verify:browser`（`scripts/verify-browser.mjs`）。自行签浏览器会话 cookie、通过 CDP 打开真实实例、逐条断言并产出截图；`--gif` 另出演示动图。
- **展示产物**：`assets/showcase/` 的 4 张截图与 1 张 GIF，全部由上面的脚本产出。
- `README.en.md`、本 `CHANGELOG.md`、`AGENTS.md`、`.freak`、`LICENSE`、`scripts/check-release.mjs`。

### 变更
- `package.json` 补齐 `description` / `keywords` / `repository` / `homepage` / `bugs` / `files` / `engines` / `author` / `publishConfig`，去掉 `private`——原先除 `name`/`version` 外几乎空白，既搜不到也无法作为包元数据被核对。
- 截图默认做隐私处理（侧栏行文字换成中性色块 + 裁到侧栏一列），避免真实工作区名、会话标题与账户余额进入公开仓库。

### 说明
- 自检只判定「零行」这一种确定情形：长列表可能被虚拟化，部分缺失不作为证据，否则会误报。
- 隐藏集合清空时 `localStorage` 留下的是 `[]` 而不是删除键。读取端本来就按空集合处理，属无害残留，不为它单独改动行为。

## 0.1.0 — 2026-10-02

### 新增
- 初版：未归档会话数 `1+ -> 0` 时自动隐藏该工作区行；右键手动隐藏；侧栏底部「已隐藏 N」与逐个恢复；当前工作区例外、「未分组」桶永不隐藏。
- 12 条纯函数单测。
