# Change Log

All notable changes to **Bookmark Bridge** are documented in this file.

## [1.2.0] - 2026-11-11

### Added

- Star (favourite) bookmarks: hover a bookmark in the view and click the star
  button to mark it; starred bookmarks are drawn with a yellow star icon. The
  flag is kept in the bookmarks JSON as `"starred": true`.
- A **Starred** group at the top of the view collects every starred bookmark of
  the workspace (they stay in their file group as well), showing `file:line`
  next to each entry.
- A single **expand / collapse all** button in the view title: it shows *collapse*
  while the tree is expanded and flips to *expand* after collapsing. The
  `Expand All Bookmarks` / `Collapse All Bookmarks` commands are also in the
  command palette.
- A **grouping toggle** in the view title: switch between *grouped by file* (with
  the Starred group) and a **flat list** of every bookmark, sorted by file and
  line. The choice is remembered across windows.

### Changed

- The *merge bookmarks* button in the view title now uses the file-add icon.

### Removed

- The *Open bookmarks JSON file* button left the view title to make room for the
  grouping toggle. The `Open Bookmarks JSON File` command is still in the command
  palette.

### Fixed

- The bookmark under the cursor now gets the **native row highlight** again, and
  the highlight is removed as soon as the cursor leaves it: the item id is rotated
  so VS Code drops the selection (the API has no `clearSelection`). The row no
  longer stays selected — with its inline buttons visible — after you move away.
- A starred bookmark is visible twice (file group and Starred group); the Starred
  copy now mirrors the highlight of the selected row.
- Deleting every bookmark of a file now also removes that file's entry from the
  JSON file. Previously the entry was mistaken for another project's data and
  written back, so the bookmarks reappeared after a reload.
- The row selected by `Ctrl+Alt+B` is now cleared by the cursor sync like any other
  highlight instead of staying selected.
- The highlight no longer gets stuck on the file row after the tree state drifts: the
  open/closed bookkeeping is healed from VS Code (it only asks for the children of
  an open group), and expand/collapse events caused by internal refreshes are
  ignored. If the bookmark row cannot be revealed, the file row is highlighted
  instead, and clearing follows whichever row was selected.
- Expanding or collapsing a file group re-applies the cursor highlight immediately,
  so the bookmark row lights up without moving the cursor away first. While the
  group is collapsed the synced bookmark keeps updating even though several
  bookmarks share the same file row, so expanding always lands on the right line.
- The sync no longer force-expands a file group you collapsed; while such a group
  is collapsed its file row is highlighted instead.
- Repeated syncs of the same bookmark are skipped.
- The bookmark hover is now shown only in the *On hover* mode. It used to appear
  in the *end of line* and *start of line* modes as well, where the label is
  already visible.
- Corrected the 1.1.0 entry above (button icon and picker wording) and the
  matching README sections, which described the old cycling behaviour.

## [1.1.0] - 2026-11-10

### Changed

- Bookmark labels in the editor are now controlled by a single mode, chosen from
  a picker opened by the eye button in the view title, the status bar item, or
  `Ctrl+Alt+Shift+L`: *hidden*, *hover*, *end of line*, *start of line*. The
  picker marks the active mode.
- New *start of line* mode keeps the label visible on very long lines, where a
  label appended after the code would require horizontal scrolling.
- A status bar indicator (`Bookmark Bridge — Labels: …`) always shows the active
  mode; clicking it opens the mode picker.

### Removed

- The `codeBookmarks.labelDisplay` and `codeBookmarks.showLabelOnHover` settings.
  The mode is remembered globally and chosen from the UI, so there is only one
  place to control it. The default stays *hidden*.

## [1.0.2] - 2026-11-10

First public release. Published as `two-way-bookmarks` with the display name
*Bookmark Bridge — Two-Way Bookmarks*, because both `bookmark-bridge` and the
display name *Bookmark Bridge* are already reserved in the Marketplace.

### Added

- **Two-way navigation**: reveal the bookmark under the cursor in the Bookmarks
  view (`Ctrl+Alt+B`), with a nearest-bookmark fallback controlled by
  `codeBookmarks.revealDistance`.
- Automatic tree selection sync while the view is visible
  (`codeBookmarks.autoRevealInTree`), without stealing the editor focus.
- Bookmarks view in the activity bar, grouped by file, with inline actions to
  edit the label, clear the label and remove the bookmark.
- Line bookmarks with multi-cursor support, optional labels, next/previous
  navigation and quick pick lists (current file / all files).
- Gutter icon, line highlight and overview ruler in a soft blue that works in
  dark and light themes; labels can be inline or hover-only.
- Line numbers follow edits (inserts, deletions, line splits) and file renames.
- Real-time JSON persistence to `codeBookmarks.persistenceFile`
  (`${workspaceFolder}/.vscode/bookmarks.json` by default), watched for external
  changes and safe to share between projects.
- Merge bookmarks from any JSON file picked on disk, with a confirmation dialog
  that reports conflicts before touching the current bookmarks.
- Single **Bookmark Bridge** submenu in the editor context menu.
