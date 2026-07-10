import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation-core';
import type { AnimeDetailRoute } from '../router/routes';
import { useNav } from '../router/Router';
import { Focusable } from '../spatial/Focusable';
import { AnimeUnityClient, EPISODE_CHUNK, type AUEpisode } from '../data/anime/AnimeUnityClient';
import { repo } from '../data/repositories';
import type { ProgressEntry } from '../data/db';

function windows(total: number): [number, number][] {
  const out: [number, number][] = [];
  for (let start = 1; start <= total; start += EPISODE_CHUNK) out.push([start, Math.min(total, start + EPISODE_CHUNK - 1)]);
  return out.length > 1 ? out : [];
}

export function AnimeDetailScreen({ route }: { route: AnimeDetailRoute }) {
  const { navigate, goBack } = useNav();
  const episodes = useSignal<AUEpisode[]>([]);
  const total = useSignal(0);
  const selected = useSignal<[number, number]>([1, EPISODE_CHUNK]);
  const loading = useSignal(true);
  const error = useSignal<string | null>(null);
  const progress = useSignal<Map<number, ProgressEntry>>(new Map());
  const animeId = Number(route.animeId);
  const load = async (range: [number, number]) => {
    loading.value = true; error.value = null;
    try {
      const page = await AnimeUnityClient.episodes(animeId, range[0], range[1]);
      episodes.value = page.episodes; total.value = Math.max(page.total, page.episodes.length); selected.value = range;
      const rows = (await repo.progress()).filter((x) => x.tmdbId === animeId && x.mediaType === 'anime');
      progress.value = new Map(rows.map((x) => [x.episode, x]));
    } catch { error.value = 'Impossibile caricare gli episodi. Riprova.'; }
    finally { loading.value = false; }
  };
  useEffect(() => { void load([1, EPISODE_CHUNK]); }, [route.animeId]);
  useEffect(() => {
    if (episodes.value.length) { const id = requestAnimationFrame(() => setFocus(`anime-ep-${episodes.value[0].id}`)); return () => cancelAnimationFrame(id); }
  }, [episodes.value]);
  const open = (ep: AUEpisode) => navigate({ name: 'player', tmdbId: animeId, mediaType: 'anime', resumeSeason: 1, resumeEpisode: ep.id, animeEpisodeId: String(ep.id), animeSlug: route.slug || undefined, title: route.title || `Anime ${animeId}`, poster: route.poster });
  const episodeState = (ep: AUEpisode) => {
    const row = progress.value.get(ep.id); if (!row || row.durationSeconds <= 0) return '';
    const pct = row.positionSeconds / row.durationSeconds;
    return pct >= .9 ? ' watched' : pct > 0 ? ' progress' : '';
  };
  return <div class="screen anime-detail-screen">
    <div class="anime-detail-header">
      <div class="anime-detail-poster" style={{ backgroundImage: route.poster ? `url(${route.poster})` : undefined }} />
      <div class="anime-detail-meta"><div class="anime-detail-title">{route.title || `Anime ${animeId}`}</div><div>{[route.type, route.year, route.status].filter(Boolean).join(' · ')}</div>{total.value ? <div>{total.value} episodi</div> : null}{route.dub === '1' ? <span class="badge anime-dub">ITA</span> : null}<p>{route.plot}</p></div>
      <Focusable focusKey="anime-back" ring fill className="back-btn" onSelect={goBack}>Indietro</Focusable>
    </div>
    {windows(total.value).length ? <div class="anime-windows">{windows(total.value).map((range) => <Focusable key={range[0]} ring fill className={`anime-window${selected.value[0] === range[0] ? ' selected' : ''}`} onSelect={() => void load(range)}>{range[0]} - {range[1]}</Focusable>)}</div> : null}
    {error.value ? <div class="anime-message">{error.value}</div> : null}
    {loading.value && !episodes.value.length ? <div class="anime-message">Caricamento…</div> : null}
    <div class="anime-episodes">{episodes.value.map((ep) => <Focusable key={ep.id} focusKey={`anime-ep-${ep.id}`} ring fill className={`anime-episode${episodeState(ep)}`} onSelect={() => open(ep)}><span>{ep.number || '•'}</span><i /></Focusable>)}</div>
  </div>;
}
