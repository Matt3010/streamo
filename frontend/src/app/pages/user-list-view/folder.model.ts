import type { CardItem } from '../../models';

export interface FolderGroup {
  id: string;
  name: string;
  items: CardItem[];
  count: number;
  movieCount: number;
  tvCount: number;
}

export function folderCountLabel(count: number): string {
  return count === 1 ? '1 titolo' : `${count} titoli`;
}

export function folderMediaLabel(group: FolderGroup): string {
  if (group.movieCount > 0 && group.tvCount > 0) return 'film e serie';
  if (group.tvCount > 0) return group.tvCount === 1 ? '1 serie' : `${group.tvCount} serie`;
  return group.movieCount === 1 ? '1 film' : `${group.movieCount} film`;
}

export function folderMeta(group: FolderGroup): string {
  return `${folderCountLabel(group.count)} • ${folderMediaLabel(group)}`;
}
