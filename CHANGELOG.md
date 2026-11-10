# Change Log

All notable changes to **Bookmark Bridge** are documented in this file.

## [1.0.1] - 2026-11-10

First public release. Published as `two-way-bookmarks`, because the extension name
`bookmark-bridge` is already reserved in the Marketplace.

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
