# Bookmark Bridge

**Two-way bookmark navigation for VS Code.** Bookmark the lines you care about, jump
from the bookmark list to the code — and, unlike most bookmark extensions, jump
straight back from the code to the bookmark in the list.

![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/newsword0620.bookmark-bridge)
![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/newsword0620.bookmark-bridge)
![Visual Studio Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/newsword0620.bookmark-bridge)
![License](https://img.shields.io/github/license/NewSword0620/Bookmark-Bridge)

<!--
TODO before publishing: add screenshots / GIFs of the view and of the two-way
jump. Relative image paths only resolve on the marketplace when package.json has
a `repository` field pointing at a GitHub/GitLab repo.
-->

## Why another bookmark extension?

Extensions like *Bookmarks* let you jump from the bookmark list to the code, but
once you are reading code there is no way back to the entry in the list — you
scroll the tree and hunt for the line you are standing on.

Bookmark Bridge closes that loop:

```
   Bookmarks view  ──────────►  code            (click a bookmark)
   code  ──────────────────►  Bookmarks view    (Ctrl+Alt+B)
```

## The two-way jump

* **List → code** — click a bookmark in the *Bookmark Bridge* view (activity bar)
  to open the file at that line.
* **Code → list** — put the cursor on a bookmarked line and press
  <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd>. The view opens, the file node
  expands, the bookmark is selected **and the keyboard focus moves into the
  view**, so you can keep navigating with the arrow keys. If the cursor line has
  no bookmark, the nearest bookmark within `revealDistance` lines (default 20) is
  used, and you are asked before jumping further away.
* **Automatic sync** — while the view is visible, moving the cursor onto a
  bookmarked line selects that bookmark in the tree, without stealing the focus
  from the editor (`autoRevealInTree`, on by default).

## Features

* Bookmark any line, with multi-cursor support.
* Optional **labels** per bookmark; show them inline or only in the hover.
* Gutter icon and line highlight, in a soft blue that fits dark and light themes.
* Next / previous bookmark navigation, per file.
* Quick pick list of bookmarks in the current file or in the whole workspace.
* File-grouped tree view with inline *edit label*, *clear label* and *remove*
  actions.
* **Bookmarks survive edits**: line numbers follow inserted/removed lines and
  file renames.
* **Live JSON persistence**: bookmarks are mirrored to a JSON file in real time,
  watched for changes, so they survive reinstalls and can be hand-edited.
* **Merge from any JSON file**: pick a bookmarks JSON file anywhere on disk,
  review what will be added (conflicts included) and confirm before merging.

## Commands and shortcuts

| Action | Shortcut (Windows/Linux · macOS) |
| --- | --- |
| Toggle bookmark on the current line | `Ctrl+Alt+K` · `Cmd+Alt+K` |
| Toggle bookmark with a label | `Ctrl+Alt+Shift+K` · `Cmd+Alt+Shift+K` |
| Add bookmark on the current line (never removes) | view title `+` button |
| Jump to next / previous bookmark in the file | `Ctrl+Alt+Right` / `Ctrl+Alt+Left` |
| **Reveal bookmark under the cursor in the view** | `Ctrl+Alt+B` · `Cmd+Alt+B` |
| List bookmarks (current file / all files) | `Ctrl+Alt+J` / `Ctrl+Alt+Shift+J` |
| Toggle inline labels | `Ctrl+Alt+Shift+L` · `Cmd+Alt+Shift+L` |
| Remove bookmarks of the current file | *Bookmark Bridge* submenu in the editor context menu |

Right-click in the editor → **Bookmark Bridge** to reach every action from a
single submenu.

## View buttons

| Button | Action |
| --- | --- |
| `+` | Add a bookmark on the current line |
| list | List bookmarks of all files |
| trash | Remove all bookmarks |
| `ab` | Toggle inline labels |
| merge | **Merge bookmarks from a JSON file…** (file picker + confirmation) |
| `{}` | Open the bookmarks JSON file |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `codeBookmarks.autoRevealInTree` | `true` | Keep the tree selection in sync with the cursor while the view is visible. |
| `codeBookmarks.revealDistance` | `20` | Fallback distance (in lines) for *Reveal Bookmark Under Cursor*. `0` disables the fallback. |
| `codeBookmarks.showGutterIcon` | `true` | Show the bookmark icon in the gutter. |
| `codeBookmarks.showLineHighlight` | `true` | Highlight bookmarked lines. |
| `codeBookmarks.labelDisplay` | `hover` | `hover` = label only in the hover, `inline` = appended to the line. |
| `codeBookmarks.showLabelOnHover` | `false` | Show label, snippet and location when hovering a bookmarked line. |
| `codeBookmarks.persistToFile` | `true` | Mirror bookmarks into a JSON file in real time. |
| `codeBookmarks.persistenceFile` | `${workspaceFolder}/.vscode/bookmarks.json` | Path of that file. Supports `~` and `${workspaceFolder}`, or any absolute path for one central file. |
| `codeBookmarks.preserveFocusWhenOpeningFromTree` | `false` | Keep the focus in the view while browsing bookmarks with the arrow keys. |

## JSON file format

Bookmarks are stored per workspace and, when `persistToFile` is on, mirrored to
`.vscode/bookmarks.json`:

```json
{
  "files": [
    {
      "path": "src/estimator.cpp",
      "bookmarks": [
        { "line": 174, "column": 28, "label": "feature extraction" },
        { "line": 200, "column": 18, "preview": "updatePose();" }
      ]
    }
  ]
}
```

* `line` is zero-based; `column`, `label` and `preview` are optional.
* Files inside a workspace folder are written as relative paths, so the same file
  can be shared between projects and operating systems.
* Entries belonging to other workspaces are preserved untouched when a shared
  file is used.
* Both this shape and a plain `{ "<path>": [ ... ] }` map are accepted when
  reading.

## Platform notes

Works on Windows, macOS and Linux; no native dependencies.

On Linux desktops `Ctrl+Alt+Left/Right` is usually grabbed by the window manager
for workspace switching — rebind *Jump to Next/Previous Bookmark* if those keys do
not reach VS Code.

## Development

```bash
git clone https://github.com/NewSword0620/Bookmark-Bridge.git
cd Bookmark-Bridge
npm install
npm run compile      # or: npm run watch

# press F5 in VS Code ("Run Extension") to try it in a second window
npm run package      # builds bookmark-bridge-1.0.0.vsix
```

## Feedback

Issues and feature requests are welcome in the
[repository](https://github.com/NewSword0620/Bookmark-Bridge/issues).

---

## 中文简介

**Bookmark Bridge** 是一款支持「双向跳转」的 VS Code 书签插件：既可以从书签列表跳到代码行，
也能用 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> 把光标所在的代码位置反向定位到书签目录，
自动展开文件并选中该书签、把焦点交给列表。

- 支持多光标打书签、带标签书签，标签可只在悬停时显示
- 浅蓝色标签图标与行高亮，暗色/亮色主题都清晰
- 编辑时行号自动跟随，文件重命名也不会错位
- 书签实时写入 `.vscode/bookmarks.json`，可手动编辑、跨机器同步；也可从任意 JSON 文件合并（合并前确认）
- 右键菜单统一收纳在 **Bookmark Bridge** 二级菜单里
