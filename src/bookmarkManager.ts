import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface Bookmark {
  /** Zero-based line number. */
  line: number;
  /** Zero-based column of the cursor when the bookmark was created. */
  column: number;
  /** Optional user defined label. */
  label?: string;
  /** Snippet of the bookmarked line, used by the tree view when the file is closed. */
  preview?: string;
  /** Starred ("favourite") bookmarks are marked with a yellow star. */
  starred?: boolean;
}

export interface FileBookmarks {
  uri: vscode.Uri;
  bookmarks: Bookmark[];
}

/** One entry of the exported JSON file. */
interface PersistedEntry {
  path: string;
  bookmarks: PersistedBookmark[];
}

interface PersistedBookmark {
  line: number;
  column: number;
  label?: string;
  preview?: string;
  starred?: boolean;
}

const STORAGE_KEY = 'codeBookmarks.data';
const MAX_PREVIEW_LENGTH = 80;
const DEFAULT_PERSIST_FILE = '${workspaceFolder}/.vscode/bookmarks.json';

export function makePreview(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > MAX_PREVIEW_LENGTH ? `${trimmed.slice(0, MAX_PREVIEW_LENGTH)}\u2026` : trimmed;
}

const byLine = (a: Bookmark, b: Bookmark): number => a.line - b.line;

function normalize(bookmark: Bookmark): Bookmark {
  const label = bookmark.label?.trim();
  return {
    line: Math.max(0, Math.trunc(bookmark.line)),
    column: Math.max(0, Math.trunc(bookmark.column ?? 0)),
    label: label ? label : undefined,
    preview: bookmark.preview,
    starred: bookmark.starred ? true : undefined,
  };
}

function fromPersisted(raw: PersistedBookmark): Bookmark | undefined {
  if (!raw || typeof raw.line !== 'number' || !Number.isFinite(raw.line)) {
    return undefined;
  }
  const bookmark: Bookmark = {
    line: Math.max(0, Math.trunc(raw.line)),
    column: typeof raw.column === 'number' ? Math.max(0, Math.trunc(raw.column)) : 0,
  };
  if (typeof raw.label === 'string' && raw.label.trim()) {
    bookmark.label = raw.label.trim();
  }
  if (typeof raw.preview === 'string' && raw.preview.trim()) {
    bookmark.preview = raw.preview;
  }
  if (raw.starred === true) {
    bookmark.starred = true;
  }
  return bookmark;
}

function toPersisted(bookmark: Bookmark): PersistedBookmark {
  const result: PersistedBookmark = { line: bookmark.line, column: bookmark.column };
  if (bookmark.label) {
    result.label = bookmark.label;
  }
  if (bookmark.preview) {
    result.preview = bookmark.preview;
  }
  if (bookmark.starred) {
    result.starred = true;
  }
  return result;
}

/** Resolves `~` and `${workspaceFolder}` and turns the value into a file URI. */
function resolvePersistUri(raw: string | undefined): vscode.Uri | undefined {
  let value = (raw ?? '').trim();
  if (!value) {
    return undefined;
  }
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    value = path.join(os.homedir(), value.slice(1));
  }
  if (value.includes('${workspaceFolder}')) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return undefined;
    }
    value = value.split('${workspaceFolder}').join(folder.uri.fsPath);
  }
  return vscode.Uri.file(path.resolve(value));
}

/**
 * Accepts the `{ "files": [ { "path", "bookmarks" } ] }` shape as well as a
 * plain `{ "<path>": [ ... ] }` map, so hand edited files keep working.
 */
function parseEntries(text: string): PersistedEntry[] | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const entries: PersistedEntry[] = [];
  const files = Array.isArray((data as { files?: unknown }).files)
    ? ((data as { files: unknown[] }).files as unknown[])
    : Array.isArray(data)
      ? (data as unknown[])
      : undefined;

  if (files) {
    for (const raw of files) {
      const entry = raw as Partial<PersistedEntry>;
      if (!entry || typeof entry.path !== 'string' || !Array.isArray(entry.bookmarks)) {
        continue;
      }
      entries.push({ path: entry.path, bookmarks: entry.bookmarks });
    }
    return entries;
  }

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      entries.push({ path: key, bookmarks: value as PersistedBookmark[] });
    }
  }
  return entries;
}

/**
 * Holds all bookmarks of the workspace, keeps the stored line numbers in sync
 * while the user edits, and (optionally) mirrors everything into a JSON file in
 * real time.
 */
export class BookmarkManager implements vscode.Disposable {
  private readonly store = new Map<string, Bookmark[]>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  /** Entries of the JSON file that belong to other workspaces; kept verbatim. */
  private foreignEntries: PersistedEntry[] = [];
  private persistUri: vscode.Uri | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private lastWrittenText: string | undefined;

  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.loadWorkspaceState();
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.trackEdits(e)),
      vscode.workspace.onDidRenameFiles((e) => this.trackRenames(e)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.configureFilePersistence(true)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('codeBookmarks.persistToFile') ||
          e.affectsConfiguration('codeBookmarks.persistenceFile')
        ) {
          void this.configureFilePersistence(true);
        }
      })
    );
    void this.configureFilePersistence(true);
  }

  // ---------------------------------------------------------------- queries

  get(uri: string): Bookmark[] {
    return this.store.get(uri) ?? [];
  }

  has(uri: string, line: number): boolean {
    return this.get(uri).some((b) => b.line === line);
  }

  find(uri: string, line: number): Bookmark | undefined {
    return this.get(uri).find((b) => b.line === line);
  }

  getAll(): FileBookmarks[] {
    const result: FileBookmarks[] = [];
    for (const [key, bookmarks] of this.store) {
      if (bookmarks.length === 0) {
        continue;
      }
      result.push({ uri: vscode.Uri.parse(key), bookmarks: bookmarks.slice() });
    }
    return result;
  }

  isEmpty(): boolean {
    return this.getAll().length === 0;
  }

  /** Absolute path of the JSON file, or `undefined` when file persistence is off. */
  getPersistenceUri(): vscode.Uri | undefined {
    return this.persistUri;
  }

  // -------------------------------------------------------------- mutations

  add(uri: string, bookmark: Bookmark): void {
    const next = this.get(uri).filter((b) => b.line !== bookmark.line);
    next.push(normalize(bookmark));
    next.sort(byLine);
    this.store.set(uri, next);
    this.changed();
  }

  setLabel(uri: string, line: number, label: string | undefined): void {
    const bookmarks = this.get(uri);
    const target = bookmarks.find((b) => b.line === line);
    if (!target) {
      return;
    }
    target.label = label?.trim() ? label.trim() : undefined;
    this.changed();
  }

  /** Toggles the star of a bookmark and returns the new state. */
  toggleStar(uri: string, line: number): boolean {
    const target = this.find(uri, line);
    if (!target) {
      return false;
    }
    const starred = !target.starred;
    target.starred = starred ? true : undefined;
    this.changed();
    return starred;
  }

  remove(uri: string, line: number): void {
    const bookmarks = this.get(uri);
    if (!bookmarks.some((b) => b.line === line)) {
      return;
    }
    const next = bookmarks.filter((b) => b.line !== line);
    if (next.length === 0) {
      this.store.delete(uri);
    } else {
      this.store.set(uri, next);
    }
    this.changed();
  }

  removeFile(uri: string): void {
    if (!this.store.has(uri)) {
      return;
    }
    this.store.delete(uri);
    this.changed();
  }

  removeAll(): void {
    if (this.store.size === 0) {
      return;
    }
    this.store.clear();
    this.changed();
  }

  /** Updates the cached preview snippet of a bookmark. */
  updatePreview(uri: string, line: number, preview: string | undefined): void {
    const target = this.find(uri, line);
    if (!target || target.preview === preview) {
      return;
    }
    target.preview = preview;
    this.changed();
  }

  // ------------------------------------------------- workspace state (fast)

  private loadWorkspaceState(): void {
    const raw = this.context.workspaceState.get<Record<string, Bookmark[]>>(STORAGE_KEY, {});
    for (const [uri, bookmarks] of Object.entries(raw ?? {})) {
      if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
        continue;
      }
      this.store.set(uri, bookmarks.map(normalize).sort(byLine));
    }
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    const data: Record<string, Bookmark[]> = {};
    for (const [uri, bookmarks] of this.store) {
      if (bookmarks.length > 0) {
        data[uri] = bookmarks;
      }
    }
    await this.context.workspaceState.update(STORAGE_KEY, data);
    await this.writeFile();
  }

  private changed(): void {
    this.onDidChangeEmitter.fire();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.saveNow();
    }, 250);
  }

  // --------------------------------------------------------- JSON file sync

  private async configureFilePersistence(reload: boolean): Promise<void> {
    this.disposeWatcher();

    const config = vscode.workspace.getConfiguration('codeBookmarks');
    const enabled = config.get<boolean>('persistToFile', true);
    const configured = config.get<string>('persistenceFile', DEFAULT_PERSIST_FILE);
    this.persistUri = enabled ? resolvePersistUri(configured) : undefined;

    if (!this.persistUri) {
      this.foreignEntries = [];
      this.lastWrittenText = undefined;
      return;
    }

    const directory = vscode.Uri.joinPath(this.persistUri, '..');
    try {
      await vscode.workspace.fs.createDirectory(directory);
    } catch {
      // The write below reports a meaningful error if the folder is unusable.
    }

    try {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(directory, path.basename(this.persistUri.fsPath))
      );
      watcher.onDidChange(() => this.scheduleFileReload());
      watcher.onDidCreate(() => this.scheduleFileReload());
      this.watcher = watcher;
    } catch {
      // Watching is a convenience only.
    }

    if (reload) {
      await this.loadFromFile();
    } else {
      await this.writeFile(true);
    }
  }

  private disposeWatcher(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
  }

  private scheduleFileReload(): void {
    if (!this.persistUri) {
      return;
    }
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined;
      void this.loadFromFile();
    }, 300);
  }

  private async readFileText(): Promise<string | undefined> {
    if (!this.persistUri) {
      return undefined;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(this.persistUri);
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return undefined;
    }
  }

  /** Loads the JSON file, taking it as the source of truth for this workspace. */
  private async loadFromFile(): Promise<void> {
    if (!this.persistUri) {
      return;
    }

    const text = await this.readFileText();
    if (text === undefined) {
      // No file yet (first run): seed it with what we already have.
      await this.writeFile(true);
      return;
    }
    if (text === this.lastWrittenText) {
      return;
    }

    const entries = parseEntries(text);
    if (!entries) {
      await this.writeFile(true);
      return;
    }

    const { imported, foreign } = await this.resolveEntries(entries);
    this.foreignEntries = foreign;

    if (imported.size === 0 && this.store.size > 0) {
      // Nothing usable in the file but we do have bookmarks in memory: keep them
      // and write them out instead of wiping the user's bookmarks.
      await this.writeFile(true);
      return;
    }

    this.store.clear();
    for (const [key, bookmarks] of imported) {
      this.store.set(key, bookmarks);
    }
    this.lastWrittenText = text;
    this.onDidChangeEmitter.fire();
  }

  /**
   * Maps a persisted path to a URI: absolute paths and `file://` URIs are used
   * as is, relative paths only when they exist inside a workspace folder (so a
   * shared file with bookmarks of other projects is not imported here).
   */
  private async resolveEntryPath(entryPath: string): Promise<vscode.Uri | undefined> {
    const value = entryPath.trim();
    if (!value) {
      return undefined;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      return vscode.Uri.parse(value);
    }
    if (path.isAbsolute(value)) {
      return vscode.Uri.file(value);
    }
    const segments = value.split(/[\\/]+/).filter(Boolean);
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const candidate = vscode.Uri.joinPath(folder.uri, ...segments);
      try {
        await vscode.workspace.fs.stat(candidate);
        return candidate;
      } catch {
        // Not in this workspace folder.
      }
    }
    return undefined;
  }

  /**
   * Splits parsed entries into those that belong to this workspace and those
   * that are kept verbatim for other projects.
   */
  private async resolveEntries(
    entries: PersistedEntry[]
  ): Promise<{ imported: Map<string, Bookmark[]>; foreign: PersistedEntry[] }> {
    const collected = new Map<string, Map<number, Bookmark>>();
    const foreign: PersistedEntry[] = [];

    for (const entry of entries) {
      const uri = await this.resolveEntryPath(entry.path);
      if (!uri) {
        foreign.push(entry);
        continue;
      }
      const key = uri.toString();
      let byNumber = collected.get(key);
      if (!byNumber) {
        byNumber = new Map<number, Bookmark>();
        collected.set(key, byNumber);
      }
      for (const raw of entry.bookmarks) {
        const bookmark = fromPersisted(raw);
        if (!bookmark) {
          continue;
        }
        // A file may be listed more than once in the JSON: merge, never drop.
        const existing = byNumber.get(bookmark.line);
        if (!existing) {
          byNumber.set(bookmark.line, bookmark);
        } else if (bookmark.label && !existing.label) {
          existing.label = bookmark.label;
        } else if (bookmark.preview && !existing.preview) {
          existing.preview = bookmark.preview;
        }
      }
    }

    const imported = new Map<string, Bookmark[]>();
    for (const [key, byNumber] of collected) {
      if (byNumber.size > 0) {
        imported.set(key, [...byNumber.values()].sort(byLine));
      }
    }

    return { imported, foreign };
  }

  /** Reads the JSON file and returns only the bookmarks of this workspace. */
  async readBookmarksFromFile(): Promise<FileBookmarks[] | undefined> {
    if (!this.persistUri) {
      return undefined;
    }
    return this.readBookmarksFromUri(this.persistUri);
  }

  /** Reads bookmarks of this workspace from any JSON file on disk. */
  async readBookmarksFromUri(uri: vscode.Uri): Promise<FileBookmarks[] | undefined> {
    let text: string;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      return undefined;
    }
    const entries = parseEntries(text);
    if (!entries) {
      return undefined;
    }
    const { imported } = await this.resolveEntries(entries);
    return [...imported.entries()].map(([key, bookmarks]) => ({
      uri: vscode.Uri.parse(key),
      bookmarks,
    }));
  }

  /**
   * Merges bookmarks read from the file into the current ones. Lines that are
   * bookmarked on both sides keep a single bookmark (the file label wins when
   * it has one), nothing is removed.
   */
  mergeBookmarks(entries: FileBookmarks[]): { added: number; updated: number } {
    let added = 0;
    let updated = 0;

    for (const entry of entries) {
      const key = entry.uri.toString();
      const byLineNumber = new Map<number, Bookmark>();
      for (const bookmark of this.get(key)) {
        byLineNumber.set(bookmark.line, bookmark);
      }

      for (const bookmark of entry.bookmarks) {
        const existing = byLineNumber.get(bookmark.line);
        if (!existing) {
          byLineNumber.set(bookmark.line, normalize(bookmark));
          added++;
          continue;
        }
        if (bookmark.label && bookmark.label !== existing.label) {
          existing.label = bookmark.label;
          updated++;
        } else if (!existing.preview && bookmark.preview) {
          existing.preview = bookmark.preview;
        }
      }

      this.store.set(key, [...byLineNumber.values()].sort(byLine));
    }

    if (added > 0 || updated > 0) {
      this.changed();
    }
    return { added, updated };
  }

  /** Path string used in the JSON file for one of our bookmarked files. */
  private entryPathFor(uri: vscode.Uri): string {
    if (uri.scheme !== 'file') {
      return uri.toString();
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') {
        continue;
      }
      const relative = path.relative(folder.uri.fsPath, uri.fsPath);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return relative.split(path.sep).join('/');
      }
    }
    return uri.fsPath;
  }

  private buildPersistedEntries(): PersistedEntry[] {
    const byPath = new Map<string, PersistedEntry>();
    for (const entry of this.foreignEntries) {
      byPath.set(entry.path, entry);
    }
    for (const [key, bookmarks] of this.store) {
      if (bookmarks.length === 0) {
        continue;
      }
      const uri = vscode.Uri.parse(key);
      byPath.set(this.entryPathFor(uri), {
        path: this.entryPathFor(uri),
        bookmarks: bookmarks.map(toPersisted),
      });
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Picks up entries written by other windows before overwriting the file. */
  private async syncForeignFromDisk(): Promise<void> {
    const text = await this.readFileText();
    if (text === undefined) {
      return;
    }
    const entries = parseEntries(text);
    if (!entries) {
      return;
    }
    const ours = new Set<string>();
    for (const key of this.store.keys()) {
      ours.add(this.entryPathFor(vscode.Uri.parse(key)));
    }
    const foreign: PersistedEntry[] = [];
    for (const entry of entries) {
      if (!ours.has(entry.path)) {
        foreign.push(entry);
      }
    }
    this.foreignEntries = foreign;
  }

  private async writeFile(force = false): Promise<void> {
    if (!this.persistUri) {
      return;
    }

    await this.syncForeignFromDisk();

    const payload = `${JSON.stringify({ files: this.buildPersistedEntries() }, null, '\t')}\n`;
    if (!force && payload === this.lastWrittenText) {
      return;
    }
    this.lastWrittenText = payload;

    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.persistUri, '..'));
      await vscode.workspace.fs.writeFile(this.persistUri, Buffer.from(payload, 'utf8'));
    } catch (error) {
      this.lastWrittenText = undefined;
      vscode.window.showWarningMessage(
        `Bookmark Bridge: could not write ${this.persistUri.fsPath} (${String(error)})`
      );
    }
  }

  // -------------------------------------------------------- edit tracking

  /**
   * Shifts bookmark line numbers when the document content changes, so the
   * bookmarks keep pointing at the same code.
   */
  private trackEdits(event: vscode.TextDocumentChangeEvent): void {
    if (event.contentChanges.length === 0) {
      return;
    }
    const key = event.document.uri.toString();
    const bookmarks = this.store.get(key);
    if (!bookmarks || bookmarks.length === 0) {
      return;
    }

    // Apply from the bottom of the document upwards so the line numbers of the
    // remaining (not yet handled) bookmarks are still valid.
    const changes = [...event.contentChanges].sort(
      (a, b) =>
        b.range.start.line - a.range.start.line ||
        b.range.start.character - a.range.start.character
    );

    let current = bookmarks;
    for (const change of changes) {
      const startLine = change.range.start.line;
      const endLine = change.range.end.line;
      const insertedLines = countLines(change.text) - 1;
      const delta = insertedLines - (endLine - startLine);
      const next: Bookmark[] = [];

      for (const bookmark of current) {
        if (bookmark.line < startLine) {
          next.push(bookmark);
        } else if (bookmark.line > endLine) {
          next.push({ ...bookmark, line: bookmark.line + delta });
        } else if (startLine === endLine) {
          // Pure insertion inside the bookmarked line: only text located after
          // the insertion point slides down, so use the bookmark column to
          // decide whether the bookmark stays put (e.g. pressing Enter at the
          // end of a bookmarked line) or moves with the text.
          const moved = bookmark.column >= change.range.start.character ? insertedLines : 0;
          next.push({ ...bookmark, line: bookmark.line + moved });
        }
        // A bookmark inside a replaced range is dropped.
      }
      current = next;
      if (current.length === 0) {
        break;
      }
    }

    if (current.length === 0) {
      this.store.delete(key);
    } else {
      this.store.set(key, current.sort(byLine));
    }
    this.changed();
  }

  private trackRenames(event: vscode.FileRenameEvent): void {
    let changed = false;
    for (const file of event.files) {
      const oldKey = file.oldUri.toString();
      const newKey = file.newUri.toString();
      const bookmarks = this.store.get(oldKey);
      if (!bookmarks || bookmarks.length === 0) {
        continue;
      }
      this.store.delete(oldKey);
      this.store.set(newKey, bookmarks);
      changed = true;
    }
    if (changed) {
      this.changed();
    }
  }

  dispose(): void {
    this.disposeWatcher();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      void this.saveNow();
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.onDidChangeEmitter.dispose();
  }
}

function countLines(text: string): number {
  if (!text) {
    return 1;
  }
  return text.split(/\r\n|\r|\n/).length;
}
