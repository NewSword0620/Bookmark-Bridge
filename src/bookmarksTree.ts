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
}

/** Aggregated group listing every starred bookmark of the workspace. */
export interface StarredGroupNode {
  kind: 'starred';
  bookmarks: BookmarkNode[];
}

export type TreeNode = FileNode | BookmarkNode | StarredGroupNode;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  private readonly subscription: vscode.Disposable;

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly manager: BookmarkManager) {
    this.rebuild();
    this.subscription = manager.onDidChange(() => {
      this.rebuild();
      this.onDidChangeTreeDataEmitter.fire();
    });
  }

  private rebuild(): void {
    this.nodeIndex.clear();
    this.fileIndex.clear();
    const files: FileNode[] = [];
    const starredNodes: BookmarkNode[] = [];

    for (const entry of this.manager.getAll()) {
      const key = entry.uri.toString();
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
    if (element.kind === 'file' || element.kind === 'starred') {
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
    item.id = `file:${node.uri.toString()}#${this.generation}`;
    item.resourceUri = node.uri;
    item.description = `${node.bookmarks.length}`;
    item.contextValue = 'file';
    // The Tree API has no per-row background, so the file row is set apart with a
    // coloured icon instead of the generic file icon.
    item.iconPath = new vscode.ThemeIcon('bookmark', new vscode.ThemeColor('charts.blue'));
    item.tooltip = new vscode.MarkdownString(
      `\`${relativePath(node.uri)}\`\n\n${node.bookmarks.length} bookmark(s)`
    );
    return item;
  }

  private getBookmarkItem(node: BookmarkNode): vscode.TreeItem {
    const label = node.label || node.preview || `Line ${node.line + 1}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.id = node.inStarredGroup
      ? `starred:${node.uri.toString()}:${node.line}`
      : `bookmark:${node.uri.toString()}:${node.line}`;
    // Inside the Starred group the file name matters more than the line alone.
    item.description = node.inStarredGroup
      ? `${basename(node.uri)}:${node.line + 1}`
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
   * Reveals a bookmark in the tree view.
   *
   * With `focus` the view is opened, ancestors are expanded, the bookmark is
   * selected and the keyboard focus moves into the view (explicit "code -> list"
   * command). Without `focus` this is the silent sync that follows the cursor:
   * a collapsed file group is *not* expanded, only selected, so the layout the
   * user arranged stays untouched.
   */
  async revealInTree(
    treeView: vscode.TreeView<TreeNode>,
    uri: string,
    line: number,
    focus: boolean
  ): Promise<boolean> {
    const node = this.getBookmarkNode(uri, line);
    if (!node) {
      return false;
    }

    if (focus) {
      try {
        await vscode.commands.executeCommand('workbench.view.extension.codeBookmarks');
      } catch {
        // The view container may not be registered yet; revealing can still work.
      }
    } else if (!treeView.visible) {
      // Never pop the view open just because the cursor moved: the caller asked
      // for a silent reveal, which only makes sense while the view is visible.
      return false;
    }

    // Silent sync: never open a collapsed group, just highlight it.
    const fileKey = uri;
    let target: TreeNode = node;
    let expand = true;
    if (!focus && this.isGroupCollapsed(fileKey)) {
      const fileNode = this.fileIndex.get(fileKey);
      if (fileNode) {
        target = fileNode;
        expand = false;
      }
    } else if (!focus) {
      expand = false;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await treeView.reveal(target, { expand, select: true, focus });
        return true;
      } catch {
        await delay(120 * (attempt + 1));
      }
    }
    return false;
  }

  dispose(): void {
    this.subscription.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
