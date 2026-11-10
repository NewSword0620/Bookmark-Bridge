import * as vscode from 'vscode';
import { BookmarkManager } from './bookmarkManager';

const HIGHLIGHT_COLOR = 'rgba(100, 181, 246, 0.12)';
const RULER_COLOR = 'rgba(100, 181, 246, 0.90)';
const LABEL_DISPLAY_KEY = 'codeBookmarks.labelDisplayMode';

/**
 * How bookmark labels are rendered in the editor:
 *
 * - `off`    nothing but the gutter icon and the line highlight
 * - `hover`  label only in the hover of the bookmarked line
 * - `inline` label appended after the code (scrolls away on long lines)
 * - `start`  label in front of the code (always visible)
 */
export type LabelDisplay = 'off' | 'hover' | 'inline' | 'start';

/** Order used by the toggle command / view button. */
export const LABEL_DISPLAY_CYCLE: LabelDisplay[] = ['off', 'hover', 'inline', 'start'];

export const LABEL_DISPLAY_DESCRIPTION: Record<LabelDisplay, string> = {
  off: 'Labels hidden',
  hover: 'Labels shown on hover',
  inline: 'Labels at the end of the line',
  start: 'Labels at the start of the line',
};

/** Short form used by the status bar indicator. */
export const LABEL_DISPLAY_SHORT: Record<LabelDisplay, string> = {
  off: 'hidden',
  hover: 'hover',
  inline: 'end of line',
  start: 'start of line',
};

/** Entry shown in the mode picker. */
export const LABEL_DISPLAY_PICKER: Record<LabelDisplay, { title: string; detail: string; icon: string }> = {
  off: { title: 'Hidden', detail: 'Only the gutter icon and the line highlight', icon: 'circle-slash' },
  hover: { title: 'On hover', detail: 'Label, snippet and location in the line hover', icon: 'eye' },
  inline: { title: 'At the end of the line', detail: 'Label appended after the code', icon: 'arrow-right' },
  start: { title: 'At the start of the line', detail: 'Label in front of the code, always visible', icon: 'arrow-left' },
};

function normalizeMode(value: string | undefined): LabelDisplay {
  return LABEL_DISPLAY_CYCLE.includes(value as LabelDisplay) ? (value as LabelDisplay) : 'off';
}

/**
 * Draws the gutter icon, the line highlight and the bookmark label in the
 * editor for every bookmarked line.
 */
export class BookmarkDecorations implements vscode.Disposable {
  private lineType: vscode.TextEditorDecorationType | undefined;
  private readonly labelTypes = new Map<string, vscode.TextEditorDecorationType>();
  private readonly disposables: vscode.Disposable[] = [];
  private labelDisplay: LabelDisplay;
  private readonly onDidChangeLabelDisplayEmitter = new vscode.EventEmitter<LabelDisplay>();

  /** Fires whenever the editor label mode changes. */
  readonly onDidChangeLabelDisplay = this.onDidChangeLabelDisplayEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: BookmarkManager
  ) {
    this.labelDisplay = normalizeMode(context.globalState.get<string>(LABEL_DISPLAY_KEY, 'off'));
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

  getLabelDisplay(): LabelDisplay {
    return this.labelDisplay;
  }

  async setLabelDisplay(mode: LabelDisplay): Promise<void> {
    if (mode === this.labelDisplay) {
      return;
    }
    this.labelDisplay = mode;
    // Label decoration types encode the anchor (start/end of line), so they have
    // to be rebuilt when the mode changes. Disposing them also clears the text
    // they rendered in every visible editor.
    this.disposeLabelTypes();
    await this.context.globalState.update(LABEL_DISPLAY_KEY, mode);
    this.refreshAll();
    this.onDidChangeLabelDisplayEmitter.fire(mode);
  }

  private createTypes(): void {
    this.lineType?.dispose();
    this.disposeLabelTypes();

    const config = vscode.workspace.getConfiguration('codeBookmarks');
    const showGutter = config.get<boolean>('showGutterIcon', true);
    const showHighlight = config.get<boolean>('showLineHighlight', true);

    this.lineType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: showHighlight ? HIGHLIGHT_COLOR : undefined,
      overviewRulerColor: RULER_COLOR,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      gutterIconPath: showGutter ? this.gutterIcon() : undefined,
      gutterIconSize: 'contain',
    });
  }

  private disposeLabelTypes(): void {
    for (const type of this.labelTypes.values()) {
      type.dispose();
    }
    this.labelTypes.clear();
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
    const mode = this.labelDisplay;
    const labelsInline = mode === 'inline' || mode === 'start';

    for (const bookmark of bookmarks) {
      if (bookmark.line >= editor.document.lineCount) {
        continue;
      }

      lineRanges.push({
        range: new vscode.Range(bookmark.line, 0, bookmark.line, 0),
        hoverMessage:
          mode === 'off'
            ? undefined
            : hoverMessage(bookmark.label, bookmark.preview, `${location}:${bookmark.line + 1}`),
      });

      if (!labelsInline || !bookmark.label) {
        continue;
      }

      const type = this.getLabelType(bookmark.label);
      const column =
        mode === 'start' ? 0 : editor.document.lineAt(bookmark.line).text.length;
      const ranges = labelRanges.get(type) ?? [];
      ranges.push({ range: new vscode.Range(bookmark.line, column, bookmark.line, column) });
      labelRanges.set(type, ranges);
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
    const anchor = this.labelDisplay === 'start' ? 'start' : 'end';
    const key = `${anchor}|${label}`;
    let type = this.labelTypes.get(key);
    if (!type) {
      const style = {
        contentText: anchor === 'start' ? `${label}  ` : `  ${label}`,
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'italic',
        margin: anchor === 'start' ? '0 1.5em 0 0' : '0 0 0 1.5em',
      };
      type = vscode.window.createTextEditorDecorationType(
        anchor === 'start' ? { before: style } : { after: style }
      );
      this.labelTypes.set(key, type);
    }
    return type;
  }

  dispose(): void {
    this.lineType?.dispose();
    this.disposeLabelTypes();
    this.onDidChangeLabelDisplayEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

function hoverMessage(
  label: string | undefined,
  preview: string | undefined,
  location: string
): vscode.MarkdownString {
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
