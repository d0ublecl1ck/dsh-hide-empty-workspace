# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的分节习惯，版本号遵循语义化版本。

## 0.4.0 — 2026-10-02

### 变更
- **恢复入口改用官方 `Modal`**：侧栏底部的「已隐藏 N」不再就地展开一个自绘小面板，而是打开与 Desktop 同款的居中对话框（标题、说明、每行一个「恢复」、主色「关闭」、右上关闭叉、Esc 与遮罩点击关闭、关闭后焦点归还）。恢复最后一个后对话框自动关闭。
- **展示产物扩到 5 帧**：新增 `assets/showcase/4-restore-dialog.png` 并列入 `screenshots.json`；原 `4-restored.png` 更名为 `5-restored.png`。

### 说明
- 对话框文案（标题 / 说明 / 恢复 / 关闭）与行菜单文案一样集中在 `client.js`，由单测钉住。
- 官方 `Modal` 来自 platform seed 的 `@deepseek-ai/dsh-client-ui-primitives`，插件没有新增运行时依赖。

## 0.3.0 — 2026-10-02

### 变更
- **手动隐藏改挂官方工作区行菜单**：不再自建右键菜单，改为在官方工作区行 hover 出现的「…」菜单末尾追加「隐藏工作区」。官方没有工作区行 action 的 slot，因此走 DOM 追加，并从当前打开的菜单克隆菜单项 class，样式跟随官方；菜单项点击后主动派发 Escape 关闭官方菜单（它不是官方 React 树里的节点，用不了官方的关闭 hook）。
- **移除右键入口**：插件自建的右键菜单与相关判定一并删除。

### 修复
- **右键点了「隐藏工作区」没反应**：旧实现在任意 `pointerdown` 上关闭自建菜单，真实鼠标按下时菜单节点先被卸载，随后的 `click` 落空；只有 `element.click()` 这类合成事件不受影响，所以一直没被发现。
- **验收脚本改走真实指针序列**：`scripts/verify-browser.mjs` 的交互全部改用 CDP `Input.dispatchMouseEvent`（移动 → 按下 → 抬起），不再用 `element.click()`；并新增「官方行菜单里出现隐藏入口」「真实鼠标点击后动作生效」「追加项关闭官方菜单」三条断言。旧脚本对上面的失效完全无感，一直是假绿。

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
