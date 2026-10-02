<sub>🌐 <a href="README.md">中文</a> · <b>English</b></sub>

<div align="center">

# dsh-hide-empty-workspace

> *"The moment you archive its last session, the empty workspace removes itself from the sidebar."*

![DSH plugin](https://img.shields.io/badge/DSH-plugin-blueviolet)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![no data writes](https://img.shields.io/badge/archive%20%C2%B7%20delete%20%C2%B7%20rewrite-none-brightgreen)

**Automatic sidebar housekeeping. It acts on exactly one rule: a workspace's unarchived session count drops from `1+` to `0`. It never archives, deletes or rewrites workspaces — the only thing it writes is a hidden-set in your browser.**

[The problem](#the-problem) · [What it looks like](#what-it-looks-like) · [Install](#install) · [When it fires](#when-it-fires) · [How it differs](#how-it-differs) · [Safety](#safety) · [Layout](#layout) · [Verification](#verification)

</div>

---

## The problem

Archiving is a manual action in DSH, and nobody tells you that a workspace has gone empty.

So the sidebar rots: you open one or two sessions in a project, archive them when you are done, and the workspace itself stays — no sessions, no purpose, one more row. After a dozen of those, the workspaces you actually use have been pushed below the fold.

This plugin turns "it is empty now" into a passive signal: the moment a workspace's unarchived session count falls from `1+` to `0`, its sidebar row hides itself.

**That moment is the only moment it acts on its own.** Manual hiding lives in each workspace row's own "..." menu, and the restore entry sits at the bottom of the sidebar. The plugin owns no state.

## What it looks like

![The "隐藏工作区" entry inside a workspace row menu, and the "已隐藏 N" entry at the bottom](assets/showcase/hide-empty-workspace.gif)

The frame above is clipped to the sidebar column, with workspace names redacted. Every frame was produced by `npm run verify:browser` against a live instance (DSH Desktop, 2026-10-02, 24 workspaces).

The same run, verbatim:

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
PASS  restore returned the hidden set to its original value: (empty)
PASS  no workspace row is left hidden (0)
11 passed, 0 failed
```

The `display:none` line is a measured confirmation of the exception: hiding two workspaces in a row leaves exactly one at `display:none` — the other is the workspace currently in use, which stays visible by design.

## Install

```sh
# straight from GitHub (shortest; no npm account needed)
dsh plugin --profile web add https://codeload.github.com/d0ublecl1ck/dsh-hide-empty-workspace/tar.gz/refs/heads/main

# while editing the source, link the working copy instead
dsh plugin --profile web add /absolute/path/dsh-hide-empty-workspace
```

`dsh plugin add` writes both `dependencies` and `dsh.profile.bundles` in the profile, so a page refresh is enough.

## When it fires

- **Automatic**: you archive a workspace's last unarchived session → its row hides.
- **Manual**: hover any workspace row and pick "隐藏工作区" from its "..." menu.
- **Restore**: the "已隐藏 N" entry at the bottom of the sidebar.
- **Automatic restore**: a hidden workspace gains an unarchived session again → it reappears.

It will not fire for:

- **A freshly added workspace.** A new workspace has no sessions, but it is genuinely new to the plugin, so it is only recorded, never hidden. This is exactly why the plugin does not implement "hide when empty".
- **The workspace in use**, which stays visible even when it matches the rule.
- **The "ungrouped" bucket**, which is never hidden.

## How it differs

| | What it does | Difference |
|---|---|---|
| [SUZUNAMI/dsh-workspace-hide](https://github.com/SUZUNAMI/dsh-workspace-hide) | Per-workspace toggles in Settings; hiding **also archives** that workspace's sessions | You must visit Settings, and it writes archive state. This plugin is automatic and writes no data |
| [Robert-Wang-08/dsh-plugin-sidebar-visibility](https://github.com/Robert-Wang-08/dsh-plugin-sidebar-visibility) | Seven features in one package: hide, collapse, drag-reorder, session rename/fork/archive/favorite | A feature bundle. This plugin does one thing with zero configuration |
| [KannaKuron/dsh-better-workspace](https://github.com/KannaKuron/dsh-better-workspace) | A two-level folder tree for sidebar workspaces | It replaces the sidebar tree; when both are enabled the row markers belong to it, and this plugin's self-check banner will tell you it is no longer working |
| [0imzero/dsh-workspace-menu](https://github.com/0imzero/dsh-workspace-menu) | A home-page context menu: pin, rename, archive, fork | A menu, with no automatic decision |

## Safety

- **Never archives, unarchives or deletes** any session or workspace.
- **Never rewrites the workspace registry**: it does not touch the `workspaces` service or `settings.yaml`.
- **Never talks to the network.**
- **The only write** is a hidden-set in browser `localStorage` (`dsh-hide-empty-workspace.hidden.v1`). Clear it and everything is back.
- **Never replaces the official UI**: it only toggles `display` on rows the shell already rendered and appends one entry to the row's own "..." menu; it does not take over or redraw any shipped component. If a DSH upgrade removes those rows it will not fail silently — the sidebar footer shows `⚠ 工作区行标记失配，插件未生效`.

## Layout

```text
index.js                    host half (this plugin needs no host capability; a placeholder apply)
client.js                   browser half: the rule, the row-menu entry, the restore entry, the self-check
cordis.patch.yml            the bundle layer that inserts this plugin
tests/hidden-workspaces.test.mjs   19 pure-function unit tests
scripts/verify-browser.mjs  live-browser verification + showcase recording
scripts/check-release.mjs   offline release gate
assets/showcase/            screenshots and GIF produced by verify-browser
screenshots.json            storefront screenshot manifest
AGENTS.md                   boundaries and commands for the next session
.freak                      open leads: competitor watch + unverified list
```

## Verification

```sh
npm test                  # 19 pure-function unit tests
npm run verify:browser    # live browser verification (11 assertions); needs a running instance
npm run check-release     # release gate: manifest, entry points, module id, platform seed, version match
npm run verify            # test + check-release
```

`npm run verify:browser` does its own authentication and evidence gathering: it reads the `client-connection/browser-session` secret from `$DSH_HOME/.credentials.yaml`, signs a browser session cookie in the `v1.<payload>.<hmac>` form, injects it over CDP, opens the instance, asserts eleven things and keeps the screenshots. Captures redact the sidebar row text and clip to the sidebar column by default (`--no-redact` disables it). It hides two workspaces along the way and then **treats restoring them as part of the assertions**, so it leaves no trace.

Unit tests cannot tell you whether the slot ever mounted, so every claim that the plugin works must come with `verify:browser` output.
