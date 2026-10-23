// Reading history and bookmarks for ZIM content (shared by reader, home and courses).
import { db } from '@/db';

export type HistoryEntry = { id: number; itemId: string; path: string; title: string; visitedAt: number };
export type Bookmark = { id: number; itemId: string; path: string; title: string; createdAt: number };

export function recordVisit(itemId: string, path: string, title: string) {
  const d = db();
  // Collapse repeated visits to the same page into one entry.
  d.runSync('DELETE FROM history WHERE item_id = ? AND path = ?', itemId, path);
  d.runSync('INSERT INTO history (item_id, path, title, visited_at) VALUES (?, ?, ?, ?)', itemId, path, title, Date.now());
}

export function recentHistory(limit = 20, itemId?: string): HistoryEntry[] {
  const rows = itemId
    ? db().getAllSync<{ id: number; item_id: string; path: string; title: string; visited_at: number }>(
        'SELECT * FROM history WHERE item_id = ? ORDER BY visited_at DESC LIMIT ?',
        itemId,
        limit,
      )
    : db().getAllSync<{ id: number; item_id: string; path: string; title: string; visited_at: number }>(
        'SELECT * FROM history ORDER BY visited_at DESC LIMIT ?',
        limit,
      );
  return rows.map((r) => ({ id: r.id, itemId: r.item_id, path: r.path, title: r.title, visitedAt: r.visited_at }));
}

export function clearHistory() {
  db().runSync('DELETE FROM history');
}

export function isBookmarked(itemId: string, path: string): boolean {
  return !!db().getFirstSync('SELECT 1 FROM bookmarks WHERE item_id = ? AND path = ?', itemId, path);
}

export function toggleBookmark(itemId: string, path: string, title: string): boolean {
  if (isBookmarked(itemId, path)) {
    db().runSync('DELETE FROM bookmarks WHERE item_id = ? AND path = ?', itemId, path);
    return false;
  }
  db().runSync('INSERT INTO bookmarks (item_id, path, title, created_at) VALUES (?, ?, ?, ?)', itemId, path, title, Date.now());
  return true;
}

export function listBookmarks(itemId?: string): Bookmark[] {
  const rows = itemId
    ? db().getAllSync<{ id: number; item_id: string; path: string; title: string; created_at: number }>(
        'SELECT * FROM bookmarks WHERE item_id = ? ORDER BY created_at DESC',
        itemId,
      )
    : db().getAllSync<{ id: number; item_id: string; path: string; title: string; created_at: number }>('SELECT * FROM bookmarks ORDER BY created_at DESC');
  return rows.map((r) => ({ id: r.id, itemId: r.item_id, path: r.path, title: r.title, createdAt: r.created_at }));
}
