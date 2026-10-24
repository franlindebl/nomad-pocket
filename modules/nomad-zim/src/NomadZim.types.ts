import type { StyleProp, ViewStyle } from 'react-native';

/** Raw archive info returned by the native `openArchive`. */
export type NativeZimInfo = {
  uuid: string;
  title: string;
  description: string;
  language: string;
  creator: string;
  publisher: string;
  date: string;
  name: string;
  articleCount: number;
  mediaCount: number;
  mainPath: string | null;
  hasFulltextIndex: boolean;
  hasTitleIndex: boolean;
  /** data:image/png;base64,… */
  illustration: string | null;
};

export type NativeZimHit = {
  path: string;
  title: string;
  /** May contain <b> highlight markup from Xapian. */
  snippet?: string;
  wordCount?: number;
};

export type NativeZimEntry = { path: string; title: string; mimeType: string; size: number; redirect: boolean };

export type NativeZimContent = { path: string; title: string; mimeType: string; content: string };

export type NomadZimNativeModule = {
  openArchive(id: string, path: string): Promise<NativeZimInfo>;
  closeArchive(id: string): void;
  isOpen(id: string): boolean;
  suggest(id: string, query: string, limit: number): Promise<NativeZimHit[]>;
  search(id: string, query: string, limit: number): Promise<NativeZimHit[]>;
  getEntry(id: string, path: string): Promise<NativeZimEntry | null>;
  getContent(id: string, path: string): Promise<NativeZimContent | null>;
  getMainPath(id: string): Promise<string | null>;
  randomPath(id: string): Promise<string | null>;
  /** HTML articles in title order (redirects skipped), at most `limit`. */
  listArticles(id: string, limit: number): Promise<NativeZimHit[]>;
  /** iOS: sets NSURLIsExcludedFromBackupKey. Android: no-op (returns false). */
  excludeFromBackup(path: string): Promise<boolean>;
};

export type ZimNavigationEvent = { path: string; title: string; canGoBack: boolean; canGoForward: boolean };
export type ZimLoadEndEvent = { path: string; title?: string; error?: string };

export type ZimWebViewProps = {
  /** Installed item id of an archive opened with `openArchive`. */
  archiveId: string;
  /** Path to show; "" or undefined = main page. Changing it navigates. */
  path?: string;
  darkMode?: boolean;
  /** Text size in percent (100 = default). */
  textZoom?: number;
  onNavigationChange?: (event: { nativeEvent: ZimNavigationEvent }) => void;
  onLoadEnd?: (event: { nativeEvent: ZimLoadEndEvent }) => void;
  style?: StyleProp<ViewStyle>;
};

export type ZimWebViewRef = {
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  loadPath(path: string): Promise<void>;
  setTextZoom(percent: number): Promise<void>;
  setDarkMode(on: boolean): Promise<void>;
  /** Finds the next (or previous) match; resolves with whether anything matched. */
  findInPage(text: string, backwards?: boolean): Promise<{ found: boolean; matches?: number; active?: number }>;
  clearFind(): Promise<void>;
};
