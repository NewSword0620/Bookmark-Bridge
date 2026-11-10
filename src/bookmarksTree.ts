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
}

export type TreeNode = FileNode | BookmarkNode;

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
  private roots: FileNode[] = [];
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
        };
        fileNode.bookmarks.push(node);
        this.nodeIndex.set(nodeKey(key, bookmark.line), node);
      }
      files.push(fileNode);
      this.fileIndex.set(key, fileNode);
    }

    files.sort((a, b) => relativePath(a.uri).localeCompare(relativePath(b.uri)));
    this.roots = files;
  }

  getBookmarkNode(uri: string, line: number): BookmarkNode | undefined {
    return this.nodeIndex.get(nodeKey(uri, line));
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.roots;
    }
    if (element.kind === 'file') {
      return element.bookmarks;
    }
    return [];
  }

  getParent(element: TreeNode): TreeNode | undefined {
    if (element.kind === 'bookmark') {
      return this.fileIndex.get(element.uri.toString());
    }
    return undefined;
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element.kind === 'file' ? this.getFileItem(element) : this.getBookmarkItem(element);
  }

  private getFileItem(node: FileNode): vscode.TreeItem {
    const item = new vscode.TreeItem(basename(node.uri), vscode.TreeItemCollapsibleState.Expanded);
    item.id = `file:${node.uri.toString()}`;
    item.resourceUri = node.uri;
    item.description = `${node.bookmarks.length}`;
    item.contextValue = 'file';
    item.tooltip = new vscode.MarkdownString(
      `\`${relativePath(node.uri)}\`\n\n${node.bookmarks.length} bookmark(s)`
    );
    return item;
  }

  private getBookmarkItem(node: BookmarkNode): vscode.TreeItem {
    const label = node.label || node.preview || `Line ${node.line + 1}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.id = `bookmark:${node.uri.toString()}:${node.line}`;
    item.description = `Line:${node.line + 1}`;
    item.contextValue = node.label ? 'bookmark:labeled' : 'bookmark';
    item.iconPath = new vscode.ThemeIcon('bookmark');
    item.tooltip = new vscode.MarkdownString(
      [
        node.label ? `**${node.label}**` : undefined,
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
   * Reveals a bookmark in the tree view, expanding ancestors and (optionally)
   * moving the keyboard focus into the view. This is the "code -> bookmark
   * list" direction that the stock Bookmarks extension does not offer.
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

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await treeView.reveal(node, { expand: true, select: true, focus });
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
