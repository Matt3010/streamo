import { settings } from '../settings';

const PROXY_ORIGIN = (import.meta.env?.VITE_PROXY_ORIGIN as string | undefined) || '';
export const EPISODE_CHUNK = 120;
export const PAGE_SIZE = 30;

export interface AUAnime {
  id: number;
  slug: string | null;
  title: string | null;
  title_eng: string | null;
  title_it: string | null;
  type: string | null;
  episodes_count: number | null;
  imageurl: string | null;
  imageurl_cover: string | null;
  plot: string | null;
  date: string | null;
  status: string | null;
  dub: number | null;
}

export interface AUEpisode {
  id: number;
  number: string | null;
  scws_id: number | null;
  file_name: string | null;
}

export interface AUEpisodePage {
  episodes: AUEpisode[];
  total: number;
}

export function animeTitle(anime: AUAnime): string {
  return [anime.title_eng, anime.title_it, anime.title, anime.slug]
    .find((x) => x?.trim())?.trim() ?? `Anime ${anime.id}`;
}

function baseUrl(): string {
  return settings.animeUnityBaseUrl.value.trim().replace(/\/+$/, '');
}

async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${PROXY_ORIGIN}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify({ ...body, baseUrl: baseUrl() }) : undefined,
  });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `AnimeUnity HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const AnimeUnityClient = {
  async browse(offset = 0): Promise<AUAnime[]> {
    const data = await request<{ records?: AUAnime[] }>('/anime/browse', { offset });
    return data.records ?? [];
  },
  async search(title: string): Promise<AUAnime[]> {
    const q = title.trim();
    if (!q) return [];
    const data = await request<{ records?: AUAnime[] }>('/anime/search', { title: q });
    return data.records ?? [];
  },
  async episodes(animeId: number, start: number, end: number): Promise<AUEpisodePage> {
    return request<AUEpisodePage>('/anime/episodes', { animeId, start, end });
  },
  async embedUrl(animeId: number, episodeId: number, slug: string | null): Promise<string> {
    const data = await request<{ embedUrl: string }>('/anime/embed', { animeId, episodeId, slug });
    return data.embedUrl;
  },
};
