import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation-core';
import { Focusable } from '../spatial/Focusable';
import { useNav } from '../router/Router';
import { AnimeStore } from '../state/AnimeStore';
import { animeTitle, type AUAnime } from '../data/anime/AnimeUnityClient';
import { ProgressMediaCard } from '../components/ProgressMediaCard';

function AnimeCard({ anime, onSelect }: { anime: AUAnime; onSelect: () => void }) {
  return <Focusable scale={1.05} className="card-focus" focusKey={`anime-${anime.id}`} onSelect={onSelect}>
    <div class="card-poster" style={{ backgroundImage: anime.imageurl ? `url(${anime.imageurl})` : undefined }}>
      {anime.dub === 1 ? <span class="badge anime-dub">ITA</span> : null}
    </div>
    <div class="card-label">{animeTitle(anime)}</div>
  </Focusable>;
}

export function AnimeScreen() {
  const { navigate } = useNav();
  const screenRef = useSignal<HTMLDivElement | null>(null);
  useEffect(() => {
    void AnimeStore.loadContinue();
    if (!AnimeStore.loaded) void AnimeStore.reload();
    const id = requestAnimationFrame(() => setFocus('anime-search'));
    return () => cancelAnimationFrame(id);
  }, []);
  const open = (anime: AUAnime) => navigate({
    name: 'animeDetail', animeId: String(anime.id), slug: anime.slug ?? '', title: animeTitle(anime),
    poster: anime.imageurl ?? undefined, type: anime.type ?? undefined, year: anime.date?.slice(0, 4),
    status: anime.status ?? undefined, dub: anime.dub === 1 ? '1' : undefined, plot: anime.plot ?? undefined,
  });
  const resume = (entry: typeof AnimeStore.continueEntries.value[number]) => {
    if (entry.providerEpisodeId) navigate({ name: 'player', tmdbId: entry.tmdbId, mediaType: 'anime', resumeSeason: 1, resumeEpisode: entry.episode, title: entry.title, poster: entry.posterPath ?? undefined, animeEpisodeId: String(entry.providerEpisodeId), animeSlug: entry.providerSlug ?? undefined });
    else navigate({ name: 'animeDetail', animeId: String(entry.tmdbId), slug: entry.providerSlug ?? '', title: entry.title, poster: entry.posterPath ?? undefined });
  };
  const onScroll = () => {
    const el = screenRef.value;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 600) void AnimeStore.loadMore();
  };
  return <div class="screen anime-screen" ref={(el) => { screenRef.value = el; }} onScroll={onScroll}>
    {AnimeStore.continueEntries.value.length ? <div class="rail">
      <div class="rail-title">Continua a guardare</div>
      <div class="rail-row">{AnimeStore.continueEntries.value.map((e) => <ProgressMediaCard key={`${e.tmdbId}-${e.episode}`} entry={e} onSelect={() => resume(e)} />)}</div>
    </div> : null}
    <div class="anime-heading">Anime</div>
    <Focusable focusKey="anime-search" ring fill className="anime-search-wrap" onSelect={() => document.querySelector<HTMLInputElement>('.anime-search')?.focus()}>
      <input class="anime-search" value={AnimeStore.query.value} placeholder="Cerca anime" onInput={(e) => AnimeStore.setQuery(e.currentTarget.value)} />
    </Focusable>
    {AnimeStore.error.value && !AnimeStore.catalog.value.length ? <div class="anime-message"><div>Catalogo non disponibile</div><div>{AnimeStore.error.value}</div><Focusable ring fill focusKey="anime-retry" onSelect={() => void AnimeStore.reload()}>Riprova</Focusable></div>
      : AnimeStore.loading.value && !AnimeStore.catalog.value.length ? <div class="anime-message">Caricamento…</div>
      : !AnimeStore.catalog.value.length && AnimeStore.query.value.trim() ? <div class="anime-message">Nessun risultato.</div>
      : <div class="grid-home anime-grid">{AnimeStore.catalog.value.map((anime) => <AnimeCard key={anime.id} anime={anime} onSelect={() => open(anime)} />)}</div>}
    {AnimeStore.loading.value && AnimeStore.catalog.value.length ? <div class="anime-message">Caricamento…</div> : null}
  </div>;
}
