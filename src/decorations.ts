import * as vscode from 'vscode';
import { BookmarkManager } from './bookmarkManager';

const HIGHLIGHT_COLOR = 'rgba(100, 181, 246, 0.12)';
const RULER_COLOR = 'rgba(100, 181, 246, 0.90)';

/**
 * Draws the gutter icon, the line highlight and the bookmark label in the
 * editor for every bookmarked line.
 */
export class BookmarkDecorations implements vscode.Disposable {
  private lineType: vscode.TextEditorDecorationType | undefined;
  private readonly labelTypes = new Map<string, vscode.TextEditorDecorationType>();
  private readonly disposables: vscode.Disposable[] = [];
  private showInlineLabels = false;
  private showLabelOnHover = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: BookmarkManager
  ) {
    this.createTypes();
    this.disposables.push(
      manager.onDidChange(() => this.refreshAll()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.refresh(editor);
        }
        this.refreshAll();
      }),
      vscode.window.onDidChangeActiveColorTheme(() => {
        this.createTypes();
        this.refreshAll();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('codeBookmarks')) {
          this.createTypes();
          this.refreshAll();
        }
      })
    );
    this.refreshAll();
  }

  private createTypes(): void {
    this.lineType?.dispose();
    for (const type of this.labelTypes.values()) {
      type.dispose();
    }
    this.labelTypes.clear();

    const config = vscode.workspace.getConfiguration('codeBookmarks');
    const showGutter = config.get<boolean>('showGutterIcon', true);
    const showHighlight = config.get<boolean>('showLineHighlight', true);
    this.showInlineLabels = config.get<string>('labelDisplay', 'hover') === 'inline';
    this.showLabelOnHover = config.get<boolean>('showLabelOnHover', false);

    this.lineType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: showHighlight ? HIGHLIGHT_COLOR : undefined,
      overviewRulerColor: RULER_COLOR,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      gutterIconPath: showGutter ? this.gutterIcon() : undefined,
      gutterIconSize: 'contain',
    });
  }

  private gutterIcon(): vscode.Uri {
    const kind = vscode.window.activeColorTheme.kind;
    const file = kind === vscode.ColorThemeKind.Light ? 'bookmark-light.svg' : 'bookmark-dark.svg';
    return vscode.Uri.joinPath(this.context.extensionUri, 'resources', file);
  }

  private refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.refresh(editor);
    }
  }

  private refresh(editor: vscode.TextEditor): void {
    if (!this.lineType) {
      return;
    }

    const bookmarks = this.manager.get(editor.document.uri.toString());
    const lineRanges: vscode.DecorationOptions[] = [];
    const labelRanges = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>();
    const location = vscode.workspace.asRelativePath(editor.document.uri, false);

    for (const bookmark of bookmarks) {
      if (bookmark.line >= editor.document.lineCount) {
        continue;
      }
      lineRanges.push({
        range: new vscode.Range(bookmark.line, 0, bookmark.line, 0),
        hoverMessage: this.showLabelOnHover
          ? hoverMessage(bookmark.label, bookmark.preview, `${location}:${bookmark.line + 1}`)
          : undefined,
      });

      if (this.showInlineLabels && bookmark.label) {
        const type = this.getLabelType(bookmark.label);
        const lineLength = editor.document.lineAt(bookmark.line).text.length;
        const ranges = labelRanges.get(type) ?? [];
        ranges.push({ range: new vscode.Range(bookmark.line, lineLength, bookmark.line, lineLength) });
        labelRanges.set(type, ranges);
      }
    }

    editor.setDecorations(this.lineType, lineRanges);
    for (const type of this.labelTypes.values()) {
      if (!labelRanges.has(type)) {
        editor.setDecorations(type, []);
      }
    }
    for (const [type, ranges] of labelRanges) {
      editor.setDecorations(type, ranges);
    }
  }

  private getLabelType(label: string): vscode.TextEditorDecorationType {
    let type = this.labelTypes.get(label);
    if (!type) {
      type = vscode.window.createTextEditorDecorationType({
        after: {
          contentText: `  ${label}`,
          color: new vscode.ThemeColor('editorCodeLens.foreground'),
          fontStyle: 'italic',
          margin: '0 0 0 1.5em',
        },
      });
      this.labelTypes.set(label, type);
    }
    return type;
  }

  dispose(): void {
    this.lineType?.dispose();
    for (const type of this.labelTypes.values()) {
      type.dispose();
    }
    this.labelTypes.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

function hoverMessage(label: string | undefined, preview: string | undefined, location: string): vscode.MarkdownString {
  const message = new vscode.MarkdownString();
  if (label) {
    message.appendMarkdown(`**${label}**\n\n`);
  }
  if (preview) {
    message.appendMarkdown(`\`${preview}\`\n\n`);
  }
  message.appendMarkdown(location);
  return message;
}
