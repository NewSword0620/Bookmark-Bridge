# Change Log

All notable changes to **Bookmark Bridge** are documented in this file.

## [Unreleased]

### Fixed

- The bookmark hover is now shown only in the *On hover* mode. It used to appear
  in the *end of line* and *start of line* modes as well, where the label is
  already visible.

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
