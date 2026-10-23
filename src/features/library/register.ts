// ZIM feature registration. CONTRACT: `registerZimFile` is used by the library
// import flow. The ZIM work fills this in (completion handler, removal hook, init).
import type { InstalledItem } from '@/features/content/items';

/** Open a ZIM file already inside content/zim, read its metadata and register it. */
export async function registerZimFile(fileUri: string, meta?: Record<string, unknown>): Promise<InstalledItem> {
  void fileUri;
  void meta;
  throw new Error('nomad-zim native module not implemented yet');
}
