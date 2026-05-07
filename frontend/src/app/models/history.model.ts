import type { MediaType } from './media.model';

export interface HistoryItem {
  tmdb_id: number;
  media_type: MediaType;
  season: number;
  episode: number;
  title: string | null;
  poster: string | null;
  watched_at: number;
}
