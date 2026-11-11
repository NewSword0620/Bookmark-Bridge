# Bookmark Bridge

**Two-way bookmark navigation for VS Code.** Bookmark the lines you care about, jump
from the bookmark list to the code — and, unlike most bookmark extensions, jump
straight back from the code to the bookmark in the list.

![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/newsword0620.two-way-bookmarks)
![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/newsword0620.two-way-bookmarks)
![Visual Studio Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/newsword0620.two-way-bookmarks)
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
   Bookmark Bridge view  ────►  code          (click a bookmark)
   code  ───────────────────►  Bookmark Bridge view   (Ctrl+Alt+B)
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
  bookmarked line highlights that row in the tree (`autoRevealInTree`, on by
  default), and the highlight disappears again when the cursor leaves it. The
  editor keeps the focus throughout. A file group you collapsed stays collapsed;
  its file row is highlighted instead.

## Features

* Bookmark any line, with multi-cursor support.
* Optional **labels** per bookmark, rendered in four modes picked from one button:
  hidden, hover only, at the end of the line, or at the start of the line.
* Gutter icon and line highlight, in a soft blue that fits dark and light themes.
* Next / previous bookmark navigation, per file.
* Quick pick list of bookmarks in the current file or in the whole workspace.
* File-grouped tree view with inline *star*, *edit label*, *clear label* and
  *remove* actions; starred bookmarks get a yellow star and are collected in a
  **Starred** group at the top of the view.
* One button switches the view between that grouping and a **flat list** of every
  bookmark (`path:line` next to each entry).
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
| Choose the label display mode (hidden / hover / end of line / start of line) | `Ctrl+Alt+Shift+L` · `Cmd+Alt+Shift+L` |
| Star / unstar a bookmark | inline star button in the view (right-click menu works too) |
| Remove bookmarks of the current file | *Bookmark Bridge* submenu in the editor context menu |

Right-click in the editor → **Bookmark Bridge** to reach every action from a
single submenu.

## View buttons

| Button | Action |
| --- | --- |
| `+` | Add a bookmark on the current line |
| list | List bookmarks of all files |
| expand / collapse | One toggle: collapses all groups, then expands them again |
| trash | Remove all bookmarks |
| eye | Pick the label display mode (hidden / hover / end of line / start of line) |
| file + | **Merge bookmarks from a JSON file…** (file picker + confirmation) |
| list-tree / list-flat | Switch between grouped (file groups + Starred) and a flat list |

`Open Bookmarks JSON File` is available from the command palette.

Every bookmark row additionally shows inline *star*, *edit label*, *clear label*
and *remove* buttons on hover.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `codeBookmarks.autoRevealInTree` | `true` | Highlight the bookmark under the cursor in the view (and clear it again) while the view is visible. |
| `codeBookmarks.revealDistance` | `20` | Fallback distance (in lines) for *Reveal Bookmark Under Cursor*. `0` disables the fallback. |
| `codeBookmarks.showGutterIcon` | `true` | Show the bookmark icon in the gutter. |
| `codeBookmarks.showLineHighlight` | `true` | Highlight bookmarked lines. |
| `codeBookmarks.persistToFile` | `true` | Mirror bookmarks into a JSON file in real time. |
| `codeBookmarks.persistenceFile` | `${workspaceFolder}/.vscode/bookmarks.json` | Path of that file. Supports `~` and `${workspaceFolder}`, or any absolute path for one central file. |
| `codeBookmarks.preserveFocusWhenOpeningFromTree` | `false` | Keep the focus in the view while browsing bookmarks with the arrow keys. |

The editor label mode is intentionally **not** a setting. Click the eye button in
the view title, the status bar item (`🔖 Labels: …`) or press `Ctrl+Alt+Shift+L`
to open the mode picker; the active mode is marked in the list and always visible
in the status bar. The choice is remembered across windows.

## JSON file format

Bookmarks are stored per workspace and, when `persistToFile` is on, mirrored to
`.vscode/bookmarks.json`:

```json
{
  "files": [
    {
      "path": "src/estimator.cpp",
      "bookmarks": [
        { "line": 174, "column": 28, "label": "feature extraction", "starred": true },
        { "line": 200, "column": 18, "preview": "updatePose();" }
      ]
    }
  ]
}
```

* `line` is zero-based; `column`, `label`, `preview` and `starred` are optional.
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
npm run package      # builds two-way-bookmarks-<version>.vsix
```

## Feedback

Issues and feature requests are welcome in the
[repository](https://github.com/NewSword0620/Bookmark-Bridge/issues).

---

## 中文简介

**Bookmark Bridge** 是一款支持「双向跳转」的 VS Code 书签插件：既可以从书签列表跳到代码行，
也能用 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> 把光标所在的代码位置反向定位到书签目录，
自动展开文件并选中该书签、把焦点交给列表。

- 支持多光标打书签、带标签书签
- 标签四种显示方式：隐藏 / 悬停 / 行尾 / 行首，用标题栏眼睛按钮、状态栏或 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> 选择
- 书签可加星收藏，星标条目会汇总到顶部的 **Starred** 分组
- 视图可在「按文件分组」与「平铺列表」之间一键切换
- 光标停在书签行时，侧栏对应行高亮（光标离开即消失，不会一直粘着）
- 浅蓝色书签图标与行高亮，暗色/亮色主题都清晰
- 编辑时行号自动跟随，文件重命名也不会错位；自动同步时不会强制展开你已折叠的文件
- 书签实时写入 `.vscode/bookmarks.json`，可手动编辑、跨机器同步；也可从任意 JSON 文件合并（合并前确认；打开 JSON 文件的命令在命令面板里）
- 全部展开 / 折叠一键切换，右键菜单统一收纳在 **Bookmark Bridge** 二级菜单里
