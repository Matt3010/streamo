import type { CardItem } from '../../models';
import type { FolderGroup } from './folder.model';

export interface DisplayEntry {
  key: string;
  item: CardItem | null;
  group: FolderGroup | null;
  expanded: boolean;
}

export function cardKey(item: CardItem): string {
  return `${item.media_type}:${item.tmdb_id}:${item.season ?? 0}:${item.episode ?? 0}`;
}

export function normalizeFolderName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed : null;
}

export function folderIdFromName(name: string): string {
  return normalizeFolderName(name)?.toLocaleLowerCase() ?? '';
}

/* Group items by folder for the unified grid/list view. Items without
 * a folder render in-place; the first occurrence of each folder emits
 * the group entry and subsequent items of that folder are absorbed
 * into the group (their original position is implicitly preserved by
 * the first occurrence). */
export function buildDisplayEntries(
  items: CardItem[],
  foldersEnabled: boolean,
  expandedFolders: Record<string, boolean>
): DisplayEntry[] {
  if (!foldersEnabled) {
    return items.map((item) => ({
      key: cardKey(item),
      item,
      group: null,
      expanded: false
    }));
  }

  const groups = new Map<string, FolderGroup>();
  for (const item of items) {
    const folderName = normalizeFolderName(item.folderName);
    if (!folderName) continue;

    const id = folderIdFromName(folderName);
    const existing = groups.get(id);
    if (existing) {
      existing.items.push(item);
      existing.count += 1;
      if (item.media_type === 'movie') existing.movieCount += 1;
      if (item.media_type === 'tv') existing.tvCount += 1;
      continue;
    }

    groups.set(id, {
      id,
      name: folderName,
      items: [item],
      count: 1,
      movieCount: item.media_type === 'movie' ? 1 : 0,
      tvCount: item.media_type === 'tv' ? 1 : 0
    });
  }

  const emitted = new Set<string>();
  const entries: DisplayEntry[] = [];
  for (const item of items) {
    const folderName = normalizeFolderName(item.folderName);
    if (!folderName) {
      entries.push({ key: cardKey(item), item, group: null, expanded: false });
      continue;
    }

    const id = folderIdFromName(folderName);
    if (emitted.has(id)) continue;
    emitted.add(id);
    const group = groups.get(id);
    if (!group) continue;
    entries.push({
      key: `folder:${id}`,
      item: null,
      group,
      expanded: expandedFolders[id] === true
    });
  }

  return entries;
}
