import * as path from 'path';
import * as vscode from 'vscode';
import { Bookmark, BookmarkManager } from './bookmarkManager';

export interface FileNode {
  kind: 'file';
  uri: vscode.Uri;
  bookmarks: BookmarkNode[];
}

export interface BookmarkNode {
  kind: 'bookmark';
  uri: vscode.Uri;
  line: number;
  column: number;
  label?: string;
  preview?: string;
  starred?: boolean;
  /** True for the copy shown inside the "Starred" group. */
  inStarredGroup?: boolean;
  /** True for the copy shown in the flat (ungrouped) list. */
  inFlatList?: boolean;
}

/** How the view lists bookmarks. */
export type ViewMode = 'grouped' | 'flat';

/** Aggregated group listing every starred bookmark of the workspace. */
export interface StarredGroupNode {
  kind: 'starred';
  bookmarks: BookmarkNode[];
}

export type TreeNode = FileNode | BookmarkNode | StarredGroupNode;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Reveals and selects a row, retrying while VS Code finishes rendering the tree. */
async function revealAndSelect(
  treeView: vscode.TreeView<TreeNode>,
  target: TreeNode
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await treeView.reveal(target, { expand: false, select: true, focus: false });
      return true;
    } catch {
      await delay(120 * (attempt + 1));
    }
  }
  return false;
}

const nodeKey = (uri: string, line: number): string => `${uri}#${line}`;

function basename(uri: vscode.Uri): string {
  return path.basename(uri.fsPath || uri.path);
}

function relativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false);
}

export class BookmarksTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  private readonly nodeIndex = new Map<string, BookmarkNode>();
  private readonly fileIndex = new Map<string, FileNode>();
  private roots: TreeNode[] = [];
  private starred: StarredGroupNode | undefined;
  private expandedByDefault = true;
  /**
   * Bumped by "expand all" / "collapse all". Group item ids embed it so VS Code
   * treats them as new items and applies the requested collapsible state again.
   */
  private generation = 0;
  /** Groups the user collapsed; used to avoid force-expanding on silent reveal. */
  private readonly collapsedGroups = new Set<string>();
  /** Item currently selected by the cursor sync, to avoid repeats. */
  private lastSilentReveal: string | undefined;
  /**
   * Extra id salt per item. VS Code restores the selection after a refresh by
   * matching item ids, so bumping the id makes it drop the selection — the only
   * way to "unselect" a row, since the API has no clearSelection().
   */
  private readonly idSalt = new Map<string, number>();
  /**
   * Item selected by the cursor sync, so it can be unselected again. The same
   * bookmark can be visible twice (file group + Starred group); only one row can
   * carry the selection, so the other copy is highlighted on its label.
   */
  private syncedSelection: { saltKey: string; uri: string; line: number } | undefined;
  private quiet = false;
  private quietTimer: ReturnType<typeof setTimeout> | undefined;
  private viewMode: ViewMode;
  private readonly subscription: vscode.Disposable;

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly manager: BookmarkManager,
    viewMode: ViewMode = 'grouped'
  ) {
    this.viewMode = viewMode;
    this.rebuild();
    this.subscription = manager.onDidChange(() => {
      this.rebuild();
      this.onDidChangeTreeDataEmitter.fire();
    });
  }

  getViewMode(): ViewMode {
    return this.viewMode;
  }

  /** Switches between the grouped view and a single flat list. */
  setViewMode(mode: ViewMode): void {
    if (mode === this.viewMode) {
      return;
    }
    this.viewMode = mode;
    this.syncedSelection = undefined;
    this.lastSilentReveal = undefined;
    this.collapsedGroups.clear();
    this.rebuild();
    this.onDidChangeTreeDataEmitter.fire();
  }

  private rebuild(): void {
    this.nodeIndex.clear();
    this.fileIndex.clear();
    const files: FileNode[] = [];
    const starredNodes: BookmarkNode[] = [];
    const flatNodes: BookmarkNode[] = [];
    const flat = this.viewMode === 'flat';

    for (const entry of this.manager.getAll()) {
      const key = entry.uri.toString();

      if (flat) {
        for (const bookmark of entry.bookmarks) {
          const node: BookmarkNode = {
            kind: 'bookmark',
            uri: entry.uri,
            line: bookmark.line,
            column: bookmark.column,
            label: bookmark.label,
            preview: bookmark.preview,
            starred: bookmark.starred,
            inFlatList: true,
          };
          flatNodes.push(node);
          this.nodeIndex.set(nodeKey(key, bookmark.line), node);
        }
        continue;
      }

      const fileNode: FileNode = { kind: 'file', uri: entry.uri, bookmarks: [] };
      for (const bookmark of entry.bookmarks) {
        const node: BookmarkNode = {
          kind: 'bookmark',
          uri: entry.uri,
          line: bookmark.line,
          column: bookmark.column,
          label: bookmark.label,
          preview: bookmark.preview,
          starred: bookmark.starred,
        };
        fileNode.bookmarks.push(node);
        this.nodeIndex.set(nodeKey(key, bookmark.line), node);
        if (bookmark.starred) {
          // A separate copy so the group item has its own identity (and parent).
          starredNodes.push({ ...node, inStarredGroup: true });
        }
      }
      files.push(fileNode);
      this.fileIndex.set(key, fileNode);
    }

    files.sort((a, b) => relativePath(a.uri).localeCompare(relativePath(b.uri)));

    if (flat) {
      flatNodes.sort(
        (a, b) => relativePath(a.uri).localeCompare(relativePath(b.uri)) || a.line - b.line
      );
      this.starred = undefined;
      this.roots = flatNodes;
      return;
    }

    starredNodes.sort(
      (a, b) => relativePath(a.uri).localeCompare(relativePath(b.uri)) || a.line - b.line
    );

    this.starred =
      starredNodes.length > 0 ? { kind: 'starred', bookmarks: starredNodes } : undefined;
    this.roots = this.starred ? [this.starred, ...files] : files;
  }

  getBookmarkNode(uri: string, line: number): BookmarkNode | undefined {
    return this.nodeIndex.get(nodeKey(uri, line));
  }

  /** Bookmark the sync currently points at (independent of the visible target). */
  getSyncedSelection(): { uri: string; line: number } | undefined {
    const synced = this.syncedSelection;
    return synced ? { uri: synced.uri, line: synced.line } : undefined;
  }

  /**
   * Ignore expand/collapse events for a moment. Re-creating items (id changes)
   * makes VS Code emit such events for items the user did not touch, which would
   * corrupt the collapsed-group bookkeeping.
   */
  private startQuietPeriod(): void {
    this.quiet = true;
    if (this.quietTimer) {
      clearTimeout(this.quietTimer);
    }
    this.quietTimer = setTimeout(() => {
      this.quiet = false;
      this.quietTimer = undefined;
    }, 500);
  }

  private salt(key: string): number {
    return this.idSalt.get(key) ?? 0;
  }

  private saltKeyForBookmark(uri: string, line: number): string {
    return `bm:${uri}#${line}`;
  }

  private saltKeyForFile(uri: string): string {
    return `file:${uri}`;
  }

  private saltKeyForFlat(uri: string, line: number): string {
    return `flat:${uri}#${line}`;
  }

  /**
   * Selects the bookmark under the cursor in the tree (a real selection, so the
   * row gets the native highlight) without touching expansion or focus. A
   * collapsed file group is represented by its file row instead.
   */
  async selectBookmark(
    treeView: vscode.TreeView<TreeNode>,
    uri: string,
    line: number,
    force = false
  ): Promise<void> {
    const node = this.getBookmarkNode(uri, line);
    if (!node) {
      return;
    }

    const grouped = this.viewMode === 'grouped';
    const collapsed = grouped && this.isGroupCollapsed(uri);
    const fileNode = collapsed ? this.fileIndex.get(uri) : undefined;
    if (collapsed && !fileNode) {
      return;
    }

    const saltKey = !grouped
      ? this.saltKeyForFlat(uri, line)
      : collapsed
        ? this.saltKeyForFile(uri)
        : this.saltKeyForBookmark(uri, line);

    // While a group is collapsed several bookmarks of the same file share the
    // file row as target, so the render target alone cannot be used to decide
    // whether the sync state is stale: track the bookmark itself.
    const stateChanged =
      this.syncedSelection?.uri !== uri || this.syncedSelection?.line !== line;
    this.syncedSelection = { saltKey, uri, line };

    const dedupeKey = `${saltKey}#${this.generation}`;
    const skipReveal = !force && dedupeKey === this.lastSilentReveal;
    this.lastSilentReveal = dedupeKey;

    if (skipReveal) {
      // The visible row is already the right one; only repaint the mirror.
      if (stateChanged) {
        this.onDidChangeTreeDataEmitter.fire();
      }
      return;
    }

    // Render the mirrored highlight on the other copy before selecting this row.
    this.onDidChangeTreeDataEmitter.fire();

    if (fileNode && (await revealAndSelect(treeView, fileNode))) {
      return;
    }
    // Either the group is open, or our bookkeeping was wrong: highlight the
    // bookmark row and correct the state.
    if (await revealAndSelect(treeView, node)) {
      if (collapsed) {
        this.collapsedGroups.delete(uri);
      }
      return;
    }

    // Last resort: the bookmark row is not reachable, so the group must be closed.
    if (fileNode === undefined) {
      const fallback = this.fileIndex.get(uri);
      if (fallback && (await revealAndSelect(treeView, fallback))) {
        this.collapsedGroups.add(uri);
        // The selected row changed, so the salt key has to follow it — otherwise
        // clearing would bump the bookmark id and leave this row selected.
        this.syncedSelection = { saltKey: this.saltKeyForFile(uri), uri, line };
      }
    }
  }

  /**
   * Removes the highlight again by giving the synced item a new id: VS Code cannot
   * match it any more and drops the selection, so the row (and its inline buttons)
   * stops looking active as soon as the cursor leaves the bookmark.
   */
  clearSyncedSelection(): void {
    const synced = this.syncedSelection;
    this.syncedSelection = undefined;
    this.lastSilentReveal = undefined;
    if (!synced) {
      return;
    }
    this.startQuietPeriod();
    this.idSalt.set(synced.saltKey, this.salt(synced.saltKey) + 1);
    this.onDidChangeTreeDataEmitter.fire();
  }

  /** Stable key of a group node, used to track its expansion state. */
  groupKey(element: TreeNode): string | undefined {
    if (element.kind === 'file') {
      return element.uri.toString();
    }
    if (element.kind === 'starred') {
      return 'starred-group';
    }
    return undefined;
  }

  /** Records a single group being expanded/collapsed by the user. */
  setGroupExpanded(key: string, expanded: boolean): void {
    if (this.quiet) {
      return;
    }
    if (expanded) {
      this.collapsedGroups.delete(key);
    } else {
      this.collapsedGroups.add(key);
    }
  }

  isGroupCollapsed(key: string): boolean {
    return this.collapsedGroups.has(key);
  }

  /** Expands or collapses every group of the view. */
  setAllExpanded(expanded: boolean): void {
    this.expandedByDefault = expanded;
    this.generation++;
    if (expanded) {
      this.collapsedGroups.clear();
    } else {
      for (const key of this.fileIndex.keys()) {
        this.collapsedGroups.add(key);
      }
      if (this.starred) {
        this.collapsedGroups.add('starred-group');
      }
    }
    this.onDidChangeTreeDataEmitter.fire();
  }

  private groupState(): vscode.TreeItemCollapsibleState {
    return this.expandedByDefault
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.roots;
    }
    if (element.kind === 'file') {
      // VS Code asks for the children of an *expanded* group only, so this is a
      // reliable "this group is open" signal that heals stale bookkeeping.
      this.collapsedGroups.delete(element.uri.toString());
      return element.bookmarks;
    }
    if (element.kind === 'starred') {
      return element.bookmarks;
    }
    return [];
  }

  getParent(element: TreeNode): TreeNode | undefined {
    if (element.kind === 'bookmark') {
      if (element.inStarredGroup) {
        return this.starred;
      }
      return this.fileIndex.get(element.uri.toString());
    }
    return undefined;
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === 'file') {
      return this.getFileItem(element);
    }
    if (element.kind === 'starred') {
      return this.getStarredItem(element);
    }
    return this.getBookmarkItem(element);
  }

  private getStarredItem(node: StarredGroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem('Starred', this.groupState());
    item.id = `starred-group#${this.generation}`;
    item.description = `${node.bookmarks.length}`;
    item.contextValue = 'starredGroup';
    item.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
    item.tooltip = new vscode.MarkdownString(
      `**Starred** — ${node.bookmarks.length} bookmark(s) from all files`
    );
    return item;
  }

  private getFileItem(node: FileNode): vscode.TreeItem {
    const item = new vscode.TreeItem(basename(node.uri), this.groupState());
    const salt = this.salt(this.saltKeyForFile(node.uri.toString()));
    item.id = `file:${node.uri.toString()}#${this.generation}#${salt}`;
    item.resourceUri = node.uri;
    item.description = `${node.bookmarks.length}`;
    item.contextValue = 'file';
    // A coloured icon sets the file row apart from its bookmark rows.
    item.iconPath = new vscode.ThemeIcon('bookmark', new vscode.ThemeColor('charts.blue'));
    item.tooltip = new vscode.MarkdownString(
      `\`${relativePath(node.uri)}\`\n\n${node.bookmarks.length} bookmark(s)`
    );
    return item;
  }

  private getBookmarkItem(node: BookmarkNode): vscode.TreeItem {
    const label = node.label || node.preview || `Line ${node.line + 1}`;
    // The Starred-group copy mirrors the highlight of the selected row.
    const mirroredActive =
      node.inStarredGroup === true &&
      this.syncedSelection !== undefined &&
      this.syncedSelection.uri === node.uri.toString() &&
      this.syncedSelection.line === node.line;
    const item = new vscode.TreeItem(
      mirroredActive ? { label, highlights: [[0, label.length] as [number, number]] } : label,
      vscode.TreeItemCollapsibleState.None
    );

    const uriKey = node.uri.toString();
    const salt = node.inFlatList
      ? this.salt(this.saltKeyForFlat(uriKey, node.line))
      : this.salt(this.saltKeyForBookmark(uriKey, node.line));
    if (node.inFlatList) {
      item.id = `flat:${uriKey}:${node.line}#${salt}`;
    } else if (node.inStarredGroup) {
      item.id = `starred:${uriKey}:${node.line}#${salt}`;
    } else {
      item.id = `bookmark:${uriKey}:${node.line}#${salt}`;
    }

    // Outside a file group the file name matters more than the line alone.
    item.description =
      node.inStarredGroup || node.inFlatList
        ? `${relativePath(node.uri)}:${node.line + 1}`
        : `Line:${node.line + 1}`;
    // contextValue drives the inline actions: keep the `bookmark` prefix and add
    // flags for the label and the star so menu `when` clauses can match them.
    const flags = [node.label ? 'labeled' : undefined, node.starred ? 'starred' : undefined].filter(
      Boolean
    );
    item.contextValue = ['bookmark', ...flags].join(':');
    item.iconPath = node.starred
      ? new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'))
      : new vscode.ThemeIcon('bookmark');
    item.tooltip = new vscode.MarkdownString(
      [
        node.label ? `**${node.label}**` : undefined,
        node.starred ? '★ starred' : undefined,
        node.preview ? `\`${node.preview}\`` : undefined,
        `${relativePath(node.uri)}:${node.line + 1}`,
      ]
        .filter(Boolean)
        .join('\n\n')
    );
    item.command = {
      command: 'codeBookmarks._openBookmark',
      title: 'Open Bookmark',
      arguments: [node],
    };
    return item;
  }

  /**
   * Opens the view, expands the ancestors of a bookmark, selects it and moves the
   * keyboard focus into the view — the explicit "code -> list" command.
   *
   * The resulting selection is recorded, so the cursor sync can clear it again as
   * soon as the cursor leaves the bookmark (VS Code keeps the selected row
   * highlighted, with its inline actions, until something else is selected).
   */
  async revealInTree(
    treeView: vscode.TreeView<TreeNode>,
    uri: string,
    line: number
  ): Promise<boolean> {
    const node = this.getBookmarkNode(uri, line);
    if (!node) {
      return false;
    }

    try {
      await vscode.commands.executeCommand('workbench.view.extension.codeBookmarks');
    } catch {
      // The view container may not be registered yet; revealing can still work.
    }

    const saltKey =
      this.viewMode === 'flat'
        ? this.saltKeyForFlat(uri, line)
        : this.saltKeyForBookmark(uri, line);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await treeView.reveal(node, { expand: true, select: true, focus: true });
        this.syncedSelection = { saltKey, uri, line };
        this.lastSilentReveal = `${saltKey}#${this.generation}`;
        this.onDidChangeTreeDataEmitter.fire();
        return true;
      } catch {
        await delay(120 * (attempt + 1));
      }
    }
    return false;
  }

  dispose(): void {
    if (this.quietTimer) {
      clearTimeout(this.quietTimer);
      this.quietTimer = undefined;
    }
    this.subscription.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
