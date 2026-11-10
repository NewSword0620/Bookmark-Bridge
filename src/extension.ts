import * as path from 'path';
import * as vscode from 'vscode';
import { Bookmark, BookmarkManager, makePreview } from './bookmarkManager';
import { BookmarkNode, BookmarksTreeProvider, FileNode, TreeNode } from './bookmarksTree';
import {
  BookmarkDecorations,
  LABEL_DISPLAY_CYCLE,
  LABEL_DISPLAY_DESCRIPTION,
  LABEL_DISPLAY_PICKER,
  LABEL_DISPLAY_SHORT,
  LabelDisplay,
} from './decorations';

let manager: BookmarkManager;
let provider: BookmarksTreeProvider;
let treeView: vscode.TreeView<TreeNode>;

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('codeBookmarks');
}

export function activate(context: vscode.ExtensionContext): void {
  manager = new BookmarkManager(context);
  provider = new BookmarksTreeProvider(manager);
  const decorations = new BookmarkDecorations(context, manager);

  treeView = vscode.window.createTreeView('codeBookmarks.view', {
    treeDataProvider: provider,
    // Custom expand/collapse buttons instead of the built-in one, so the pair
    // can sit next to each other in the title bar.
    showCollapseAll: false,
  });

  // The expand/collapse button is a single button whose icon follows this key.
  void vscode.commands.executeCommand('setContext', 'codeBookmarks.treeExpanded', true);

  // Track which groups the user collapsed, so the silent "follow the cursor"
  // reveal can highlight a collapsed file instead of forcing it open.
  context.subscriptions.push(
    treeView.onDidExpandElement((e) => {
      const key = provider.groupKey(e.element);
      if (key) {
        provider.setGroupExpanded(key, true);
      }
    }),
    treeView.onDidCollapseElement((e) => {
      const key = provider.groupKey(e.element);
      if (key) {
        provider.setGroupExpanded(key, false);
      }
    })
  );

  // Always-visible indicator of the current label mode: the view button cycles
  // through four modes, so the mode itself has to be visible somewhere.
  const labelIndicator = vscode.window.createStatusBarItem(
    'codeBookmarks.labelDisplay',
    vscode.StatusBarAlignment.Right,
    100
  );
  const updateLabelIndicator = (mode: LabelDisplay): void => {
    labelIndicator.text = `$(bookmark) Labels: ${LABEL_DISPLAY_SHORT[mode]}`;
    labelIndicator.tooltip = new vscode.MarkdownString(
      `**Bookmark Bridge** — label display: **${LABEL_DISPLAY_SHORT[mode]}**\n\n` +
        'Click to choose another mode'
    );
    labelIndicator.command = 'codeBookmarks.toggleLabelDisplay';
    labelIndicator.show();
  };
  updateLabelIndicator(decorations.getLabelDisplay());
  context.subscriptions.push(labelIndicator, decorations.onDidChangeLabelDisplay(updateLabelIndicator));

  context.subscriptions.push(
    manager,
    provider,
    treeView,
    decorations,
    vscode.commands.registerCommand('codeBookmarks.toggle', () => toggleBookmark(false)),
    vscode.commands.registerCommand('codeBookmarks.add', () => addBookmarkAtCursor()),
    vscode.commands.registerCommand('codeBookmarks.toggleLabeled', () => toggleBookmark(true)),
    vscode.commands.registerCommand('codeBookmarks.next', () => jumpToAdjacentBookmark(true)),
    vscode.commands.registerCommand('codeBookmarks.prev', () => jumpToAdjacentBookmark(false)),
    vscode.commands.registerCommand('codeBookmarks.list', () => listBookmarks(false)),
    vscode.commands.registerCommand('codeBookmarks.listFromAllFiles', () => listBookmarks(true)),
    vscode.commands.registerCommand('codeBookmarks.clear', () => clearBookmarks(false)),
    vscode.commands.registerCommand('codeBookmarks.clearFromAllFiles', () => clearBookmarks(true)),
    vscode.commands.registerCommand('codeBookmarks.expandAll', () => setTreeExpanded(true)),
    vscode.commands.registerCommand('codeBookmarks.collapseAll', () => setTreeExpanded(false)),
    vscode.commands.registerCommand('codeBookmarks.revealInTree', () => revealCurrentLineInTree(false)),
    vscode.commands.registerCommand('codeBookmarks.toggleLabelDisplay', () => selectLabelDisplay(decorations)),
    vscode.commands.registerCommand('codeBookmarks.openPersistenceFile', () => openPersistenceFile()),
    vscode.commands.registerCommand('codeBookmarks.mergeFromFile', () => mergeFromPickedFile()),
    vscode.commands.registerCommand('codeBookmarks.revealNearestInTree', () => revealCurrentLineInTree(true)),
    vscode.commands.registerCommand('codeBookmarks._openBookmark', (node?: BookmarkNode) => {
      if (node) {
        return openBookmark(node.uri, node.line, node.column);
      }
      return undefined;
    }),
    vscode.commands.registerCommand('codeBookmarks.editLabel', (node?: BookmarkNode) => {
      if (node) {
        return editLabel(node);
      }
      return undefined;
    }),
    vscode.commands.registerCommand('codeBookmarks.toggleStar', (node?: BookmarkNode) => {
      if (node) {
        const starred = manager.toggleStar(node.uri.toString(), node.line);
        status(
          starred
            ? `Starred bookmark (line ${node.line + 1})`
            : `Star removed (line ${node.line + 1})`
        );
      }
    }),
    vscode.commands.registerCommand('codeBookmarks.clearLabel', (node?: BookmarkNode) => {
      if (node) {
        manager.setLabel(node.uri.toString(), node.line, undefined);
        status(`Label cleared (line ${node.line + 1})`);
      }
    }),
    vscode.commands.registerCommand('codeBookmarks.removeBookmark', (node?: BookmarkNode) => {
      if (node) {
        manager.remove(node.uri.toString(), node.line);
        status(`Bookmark removed (line ${node.line + 1})`);
      }
    }),
    vscode.commands.registerCommand('codeBookmarks.removeFileBookmarks', (node?: FileNode) => {
      if (node) {
        manager.removeFile(node.uri.toString());
        status(`Bookmarks removed from ${vscode.workspace.asRelativePath(node.uri, false)}`);
      }
    }),
    // Auto reveal: cursor moves onto a bookmarked line while the view is
    // visible -> select that bookmark in the tree without stealing the focus.
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!config().get<boolean>('autoRevealInTree', true)) {
        return;
      }
      if (!treeView.visible || e.textEditor !== vscode.window.activeTextEditor) {
        return;
      }
      const uri = e.textEditor.document.uri.toString();
      const line = e.selections[0]?.active.line;
      if (line === undefined || !manager.has(uri, line)) {
        return;
      }
      void provider.revealInTree(treeView, uri, line, false);
    })
  );
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}

/**
 * Expands or collapses every group and flips the icon of the single title bar
 * button (the button shows "collapse" while the tree is expanded).
 */
async function setTreeExpanded(expanded: boolean): Promise<void> {
  provider.setAllExpanded(expanded);
  await vscode.commands.executeCommand('setContext', 'codeBookmarks.treeExpanded', expanded);
}

// --------------------------------------------------------------- helpers

function status(message: string): void {
  vscode.window.setStatusBarMessage(`$(bookmark) ${message}`, 2000);
}

function bookmarkFromEditor(editor: vscode.TextEditor, line: number, column: number): Bookmark {
  const text = line < editor.document.lineCount ? editor.document.lineAt(line).text : '';
  return { line, column, preview: makePreview(text) };
}

function relativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false);
}

// ------------------------------------------------------------- bookmarking

/** Adds a bookmark without ever removing one (the "+" action of the view). */
function addBookmarkAtCursor(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open a file before adding a bookmark.');
    return;
  }

  const uri = editor.document.uri.toString();
  const columns = new Map<number, number>();
  for (const selection of editor.selections) {
    if (!columns.has(selection.active.line)) {
      columns.set(selection.active.line, selection.active.character);
    }
  }
  const lines = [...columns.keys()].sort((a, b) => a - b);

  let added = 0;
  for (const line of lines) {
    if (manager.has(uri, line)) {
      continue;
    }
    manager.add(uri, bookmarkFromEditor(editor, line, columns.get(line) ?? 0));
    added++;
  }

  if (added === 0) {
    status(`Line ${lines[0] + 1} is already bookmarked`);
  } else {
    status(added === 1 ? `Bookmark added (line ${lines[0] + 1})` : `${added} bookmarks added`);
  }
}

async function toggleBookmark(labeled: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open a file before adding a bookmark.');
    return;
  }

  const uri = editor.document.uri.toString();
  const columns = new Map<number, number>();
  for (const selection of editor.selections) {
    if (!columns.has(selection.active.line)) {
      columns.set(selection.active.line, selection.active.character);
    }
  }
  const lines = [...columns.keys()].sort((a, b) => a - b);

  if (!labeled) {
    const allMarked = lines.every((line) => manager.has(uri, line));
    if (allMarked) {
      for (const line of lines) {
        manager.remove(uri, line);
      }
      status(`Removed ${lines.length} bookmark(s)`);
      return;
    }
    let added = 0;
    for (const line of lines) {
      if (manager.has(uri, line)) {
        continue;
      }
      manager.add(uri, bookmarkFromEditor(editor, line, columns.get(line) ?? 0));
      added++;
    }
    status(added === 1 ? `Bookmark added (line ${lines[0] + 1})` : `${added} bookmarks added`);
    return;
  }

  const currentLabel = manager.find(uri, lines[0])?.label ?? '';
  const input = await vscode.window.showInputBox({
    title: 'Bookmark Label',
    prompt: 'Type a label. Leave it empty to remove the bookmark.',
    value: currentLabel,
    placeHolder: 'e.g. refactor this, TODO, entry point',
  });
  if (input === undefined) {
    return;
  }

  const label = input.trim();
  for (const line of lines) {
    const existing = manager.find(uri, line);
    if (existing) {
      if (label) {
        manager.setLabel(uri, line, label);
      } else {
        manager.remove(uri, line);
      }
    } else if (label) {
      manager.add(uri, { ...bookmarkFromEditor(editor, line, columns.get(line) ?? 0), label });
    }
  }
  status(label ? `Bookmark labeled "${label}"` : 'Bookmark removed');
}

interface LabelDisplayPick extends vscode.QuickPickItem {
  mode: LabelDisplay;
}

/** Dropdown-style picker for the editor label mode, marking the active one. */
async function selectLabelDisplay(decorations: BookmarkDecorations): Promise<void> {
  const current = decorations.getLabelDisplay();
  const items: LabelDisplayPick[] = LABEL_DISPLAY_CYCLE.map((mode) => ({
    label: LABEL_DISPLAY_PICKER[mode].title,
    description: mode === current ? 'current' : undefined,
    detail: LABEL_DISPLAY_PICKER[mode].detail,
    iconPath: new vscode.ThemeIcon(LABEL_DISPLAY_PICKER[mode].icon),
    mode,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Bookmark Label Display',
    placeHolder: `Current: ${LABEL_DISPLAY_SHORT[current]}`,
  });
  if (!picked) {
    return;
  }

  await decorations.setLabelDisplay(picked.mode);
  status(LABEL_DISPLAY_DESCRIPTION[picked.mode]);
}

/** Opens the JSON file that bookmarks are mirrored to. */
async function openPersistenceFile(): Promise<void> {
  const file = manager.getPersistenceUri();
  if (!file) {
    vscode.window.showInformationMessage(
      'File persistence is disabled. Enable "codeBookmarks.persistToFile" to store bookmarks in a JSON file.'
    );
    return;
  }
  try {
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document, { preview: false });
  } catch {
    vscode.window.showWarningMessage(`Bookmark Bridge: ${file.fsPath} does not exist yet.`);
  }
}

/**
 * Lets the user pick any JSON file, shows what would be merged and, after an
 * explicit confirmation, merges it into the current bookmarks.
 */
async function mergeFromPickedFile(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Select a bookmarks JSON file to merge',
    openLabel: 'Merge Bookmarks',
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    defaultUri: manager.getPersistenceUri(),
    filters: {
      'Bookmarks JSON': ['json'],
      'All files': ['*'],
    },
  });
  const file = picked?.[0];
  if (!file) {
    return;
  }

  const fromFile = await manager.readBookmarksFromUri(file);
  if (!fromFile) {
    vscode.window.showWarningMessage(
      `Bookmark Bridge: ${file.fsPath} could not be read or does not contain a valid bookmarks JSON.`
    );
    return;
  }

  const fileCount = fromFile.reduce((total, entry) => total + entry.bookmarks.length, 0);
  if (fileCount === 0) {
    vscode.window.showInformationMessage(
      `No bookmarks of this workspace were found in ${path.basename(file.fsPath)}.`
    );
    return;
  }

  const currentEntries = manager.getAll();
  const currentCount = currentEntries.reduce((total, entry) => total + entry.bookmarks.length, 0);
  const currentLines = new Set<string>();
  for (const entry of currentEntries) {
    for (const bookmark of entry.bookmarks) {
      currentLines.add(`${entry.uri.toString()}#${bookmark.line}`);
    }
  }
  let conflicts = 0;
  for (const entry of fromFile) {
    for (const bookmark of entry.bookmarks) {
      if (currentLines.has(`${entry.uri.toString()}#${bookmark.line}`)) {
        conflicts++;
      }
    }
  }

  const details = [
    `- ${fileCount} bookmark(s) in ${path.basename(file.fsPath)} (${fromFile.length} file(s))`,
    `- ${currentCount} bookmark(s) currently in the list`,
    conflicts > 0
      ? `- ${conflicts} line(s) are bookmarked on both sides; the label from the file wins`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n');

  const choice = await vscode.window.showWarningMessage(
    `Merge bookmarks from the JSON file into the current list?\n\n${details}`,
    { modal: true },
    'Merge'
  );
  if (choice !== 'Merge') {
    return;
  }

  const result = manager.mergeBookmarks(fromFile);
  status(`Merged ${result.added} bookmark(s), ${result.updated} label(s) updated`);
}

async function editLabel(node: BookmarkNode): Promise<void> {
  const uri = node.uri.toString();
  const input = await vscode.window.showInputBox({
    title: 'Bookmark Label',
    prompt: 'Type a label. Leave it empty to remove the bookmark.',
    value: node.label ?? '',
  });
  if (input === undefined) {
    return;
  }
  const label = input.trim();
  if (label) {
    manager.setLabel(uri, node.line, label);
  } else {
    manager.remove(uri, node.line);
  }
}

// -------------------------------------------------------------- navigation

function jumpToAdjacentBookmark(forward: boolean): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const uri = editor.document.uri.toString();
  const bookmarks = manager.get(uri);
  if (bookmarks.length === 0) {
    status('No bookmarks in this file');
    return;
  }

  const line = editor.selection.active.line;
  const target = forward
    ? bookmarks.find((b) => b.line > line) ?? bookmarks[0]
    : [...bookmarks].reverse().find((b) => b.line < line) ?? bookmarks[bookmarks.length - 1];

  goToLocation(editor, target.line, target.column, false);
}

function goToLocation(
  editor: vscode.TextEditor,
  line: number,
  column: number,
  preserveFocus: boolean
): void {
  const position = new vscode.Position(Math.min(line, editor.document.lineCount - 1), column);
  const selection = new vscode.Selection(position, position);
  editor.selection = selection;
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  if (!preserveFocus) {
    void vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
      preview: false,
    });
  }
}

async function openLocation(uri: vscode.Uri, line: number, column: number): Promise<void> {
  const preserveFocus = config().get<boolean>('preserveFocusWhenOpeningFromTree', false);
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, {
    preserveFocus,
    preview: false,
  });
  const position = new vscode.Position(Math.max(0, Math.min(line, document.lineCount - 1)), column);
  const selection = new vscode.Selection(position, position);
  editor.selection = selection;
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function openBookmark(uri: vscode.Uri, line: number, column: number): Promise<void> {
  return openLocation(uri, line, column);
}

interface BookmarkPick extends vscode.QuickPickItem {
  uri: vscode.Uri;
  line: number;
  column: number;
}

async function listBookmarks(allFiles: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const entries = allFiles
    ? manager.getAll()
    : editor
      ? [{ uri: editor.document.uri, bookmarks: manager.get(editor.document.uri.toString()) }]
      : [];

  const items: BookmarkPick[] = [];
  for (const entry of entries) {
    for (const bookmark of entry.bookmarks) {
      items.push({
        label: bookmark.label ?? bookmark.preview ?? `Line ${bookmark.line + 1}`,
        description: `${relativePath(entry.uri)}:${bookmark.line + 1}`,
        uri: entry.uri,
        line: bookmark.line,
        column: bookmark.column,
      });
    }
  }

  if (items.length === 0) {
    vscode.window.showInformationMessage(
      allFiles ? 'No bookmarks in this workspace yet.' : 'No bookmarks in the current file.'
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: allFiles ? 'Bookmarks in All Files' : 'Bookmarks in Current File',
    matchOnDescription: true,
    placeHolder: 'Select a bookmark to jump to it',
  });
  if (picked) {
    await openLocation(picked.uri, picked.line, picked.column);
  }
}

function clearBookmarks(allFiles: boolean): void {
  if (allFiles) {
    manager.removeAll();
    status('All bookmarks removed');
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  manager.removeFile(editor.document.uri.toString());
  status('Bookmarks removed from this file');
}

/**
 * The feature the stock Bookmarks extension lacks: from the cursor position
 * back to the entry inside the bookmark list.
 */
async function revealCurrentLineInTree(nearestOnly: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open a file first.');
    return;
  }

  const uri = editor.document.uri.toString();
  const line = editor.selection.active.line;
  const bookmarks = manager.get(uri);

  if (bookmarks.length === 0) {
    vscode.window.showInformationMessage('This file has no bookmarks yet.');
    return;
  }

  let target = bookmarks.find((b) => b.line === line);

  if (!target) {
    const byDistance = [...bookmarks].sort(
      (a, b) => Math.abs(a.line - line) - Math.abs(b.line - line)
    );
    const nearest = byDistance[0];
    const maxDistance = config().get<number>('revealDistance', 20);

    if (nearest && (nearestOnly || Math.abs(nearest.line - line) <= maxDistance)) {
      target = nearest;
    } else if (nearest) {
      const choice = await vscode.window.showInformationMessage(
        `No bookmark on line ${line + 1}. The nearest bookmark is on line ${nearest.line + 1}.`,
        'Reveal it'
      );
      if (choice !== 'Reveal it') {
        return;
      }
      target = nearest;
    }
  }

  if (!target) {
    return;
  }

  const revealed = await provider.revealInTree(treeView, uri, target.line, true);
  if (!revealed) {
    vscode.window.showWarningMessage('Could not reveal the bookmark in the Bookmarks view.');
  }
}
