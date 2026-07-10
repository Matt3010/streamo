import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { DetailStore } from '../state/DetailStore';
import { MediaCard } from '../components/MediaCard';
import { EpisodeCard } from '../components/EpisodeCard';
import { ImmersiveRow } from '../components/ImmersiveRow';
import { OptionOverlay } from '../components/OptionOverlay';
import { Focusable } from '../spatial/Focusable';
import { restoreFocus, recoverFocus } from '../spatial/focusMemory';
import { routeToPath } from '../router/routes';
import { InlineIcon, ICON_PATHS, SectionTitle } from '../components/Icon';
import { TMDBImage, TmdbImageSize } from '../data/tmdb/TMDBImage';
import {
  displayTitle,
  itemYear,
  primaryDate,
  type TmdbEpisodeDetail as DtoEpisode,
} from '../data/tmdb/dto';
import { strings } from '../i18n/strings';
import { useNav } from '../router/Router';
import type { Route } from '../router/routes';
import { repo } from '../data/repositories';
import { percent } from '../util/format';

export function DetailScreen({
  route,
}: {
  route: Extract<Route, { name: 'detail' }>;
}) {
  const { navigate } = useNav();
  const item = DetailStore.item.value;
  const episodes = DetailStore.episodes.value;
  const seasons = DetailStore.availableSeasonsList.value;
  const selectedSeason = DetailStore.selectedSeason.value;
  const recs = DetailStore.recommendations.value;
  const inWl = DetailStore.inWatchlist.value;
  const showPicker = DetailStore.showPicker.value;
  const candidates = DetailStore.candidates.value;
  const resolveMessage = DetailStore.resolveMessage.value;
  const pendingNav = DetailStore.pendingNav.value;
  const resume = DetailStore.resume.value;
  const lastWatched = DetailStore.lastWatched.value;
  const msgOpen = useSignal(false);
  const episodeProgress = useSignal(new Map<number, number>());

  useEffect(() => {
    void DetailStore.load(
      route.tmdbId,
      route.mediaType === 'anime' ? 'tv' : route.mediaType,
      route.resumeSeason,
      route.resumeEpisode,
    );
  }, [route.tmdbId, route.mediaType, route.resumeSeason, route.resumeEpisode]);

  useEffect(() => {
    if (route.mediaType !== 'tv' || !selectedSeason) return;
    void repo.getProgressForSeason(route.tmdbId, 'tv', selectedSeason).then((rows) => {
      episodeProgress.value = new Map(rows.map((row) => [row.episode, percent(row.positionSeconds, row.durationSeconds)]));
    });
  }, [route.tmdbId, route.mediaType, selectedSeason]);

  // Anchor: ripristina la posizione ricordata col Back, fallback sul Play.
  // Gate su !loading (non solo su item): DetailStore.load popola gli episodi
  // solo dopo diverse await sequenziali (watchlist, recommendations, cache,
  // selectSeason) successive al primo item — partire prima fa scadere il
  // retry budget di restoreFocus prima che la card episodio ricordata esista,
  // facendolo ripiegare quasi sempre sul fallback Play.
  useEffect(() => {
    if (!item || DetailStore.loading.value) return;
    return restoreFocus(
      routeToPath(route),
      'detail-play',
      lastWatched ? `detail-ep-${lastWatched.episode}` : undefined,
    );
  }, [item, DetailStore.loading.value, lastWatched]);

  // Area 3: cambio stagione rimpiazza le episode card. Se il focus era su un
  // episodio appena smontato, atterra sul primo episodio della nuova stagione
  // (o sul Play). recoverFocus è no-op se il focus è ancora vivo. Per i film
  // episodes è vuoto → il guard ritorna subito.
  useEffect(() => {
    if (episodes.length === 0) return;
    const first = episodes[0];
    return recoverFocus([
      ...(lastWatched ? [`detail-ep-${lastWatched.episode}`] : []),
      `detail-ep-${first.episodeNumber}`,
      'detail-play',
    ]);
  }, [episodes, lastWatched]);

  // Resolve pending nav from store.
  useEffect(() => {
    if (pendingNav) {
      navigate(pendingNav);
      DetailStore.clearPendingNav();
    }
  }, [pendingNav]);

  // Resolve-message overlay local open state.
  useEffect(() => {
    msgOpen.value = resolveMessage != null;
  }, [resolveMessage]);

  if (!item) {
    return (
      <div class="screen">
        <div class="stub">
          <div>{strings.loading}</div>
        </div>
      </div>
    );
  }

  const isTv = route.mediaType === 'tv' || route.mediaType === 'anime';
  const year = itemYear(item);
  const meta: string[] = [];
  if (year != null) meta.push(String(year));
  if (isTv) {
    if (item.number_of_seasons != null) meta.push(`${item.number_of_seasons} stag.`);
    if (item.number_of_episodes != null) meta.push(`${item.number_of_episodes} ep.`);
  } else if (item.runtime != null) {
    meta.push(`${item.runtime} min`);
  }
  const genres = (item.genres ?? []).map((g) => g.name).filter(Boolean).join(', ');
  const cast = (item.credits?.cast ?? []).slice(0, 6);

  const onPlay = () => {
    if (isTv) {
      if (resume) void DetailStore.playEpisode(resume.season, resume.episode);
      else if (episodes.length > 0)
        void DetailStore.playEpisode(selectedSeason, episodes[0].episodeNumber);
    } else {
      void DetailStore.play();
    }
  };

  // ponytail: DetailStore.episodes are camelCase tvlogic shape; EpisodeCard
  // expects snake_case dto shape. Adapt per-card.
  const toDtoEp = (ep: (typeof episodes)[number]): DtoEpisode => ({
    episode_number: ep.episodeNumber,
    season_number: ep.seasonNumber ?? null,
    name: ep.name ?? null,
    overview: ep.overview ?? null,
    still_path: ep.stillPath ?? null,
    air_date: ep.airDate ?? null,
    runtime: ep.runtime ?? null,
  });

  const goRec = (it: typeof recs[number]) =>
    navigate({
      name: 'detail',
      mediaType: (it.media_type as 'movie' | 'tv') ?? 'movie',
      tmdbId: it.id,
    });

  return (
    <div class="screen detail-screen">
      <div
        class="detail-hero"
        style={{
          backgroundImage: `url(${TMDBImage.url(item.backdrop_path, TmdbImageSize.W1280) ?? ''})`,
        }}
      >
        <div class="detail-scrim" />
      </div>
      <div class="detail-content">
        <div class="detail-title">{displayTitle(item)}</div>
        <div class="detail-meta">{meta.join(' • ')}</div>
        {genres && <div class="detail-genres">{genres}</div>}

        <div class="detail-actions">
          <Focusable
            focusKey="detail-play"
            scale={1.05}
            frame
            fill
            onSelect={onPlay}
            className="play-btn"
          >
            <InlineIcon path={ICON_PATHS.playArrow} size={22} />
            <span>{strings.play}</span>
          </Focusable>
          <Focusable
            focusKey="detail-wl"
            ring
            fill
            onSelect={() => void DetailStore.toggleWatchlist()}
            className="wl-btn"
          >
            <InlineIcon path={inWl ? ICON_PATHS.bookmark : ICON_PATHS.bookmarkBorder} size={20} />
            <span>{inWl ? strings.removeFromWatchlist : strings.addToWatchlist}</span>
          </Focusable>
        </div>

        {item.overview && <div class="detail-overview">{item.overview}</div>}

        {cast.length > 0 && (
          <div class="detail-cast-line">Cast: {cast.map((c) => c.name).join(', ')}</div>
        )}
      </div>

      {isTv && (
        <section class="rail">
          <SectionTitle title={strings.episodes} icon={ICON_PATHS.playCircle} />
          {/* ponytail: plain div (non Focusable) → season chip ed episode card
              registrano parent = `content` e sono sibling di play/wl/recs, così
              la nav verticale in Detail è geometrica card-to-card (card
              corrispondente per posizione, non prima/ultima). Gli span interni
              restano Focusable foglia. */}
          <div class="season-chips">
            {seasons.map((n) => (
              <Focusable
                key={n}
                focusKey={`detail-season-${n}`}
                ring
                fill
                scale={1.05}
                onSelect={() => void DetailStore.selectSeason(n)}
                className={`season-chip${selectedSeason === n ? ' selected' : ''}`}
              >
                <span>{`Stagione ${n}`}</span>
              </Focusable>
            ))}
          </div>
          <div class="rail-row">
            {episodes.map((ep) => (
              <EpisodeCard
                key={ep.episodeNumber}
                ep={toDtoEp(ep)}
                seasonNumber={selectedSeason}
                status={episodeProgress.value.get(ep.episodeNumber) >= 90 ? 'watched' : episodeProgress.value.has(ep.episodeNumber) ? 'progress' : 'none'}
                progress={episodeProgress.value.get(ep.episodeNumber)}
                focusKey={`detail-ep-${ep.episodeNumber}`}
                onSelect={() =>
                  void DetailStore.playEpisode(selectedSeason, ep.episodeNumber)
                }
              />
            ))}
          </div>
        </section>
      )}

      {recs.length > 0 && (
        <ImmersiveRow
          title={strings.recommendations}
          icon={ICON_PATHS.thumbUp}
          focusKey="detail-recs"
        >
          {recs.map((it) => (
            <MediaCard
              key={`${it.id}-${it.media_type}`}
              item={it}
              focusKey={`detail-rec-${it.id}`}
              onSelect={() => goRec(it)}
            />
          ))}
        </ImmersiveRow>
      )}

      {showPicker && (
        <OptionOverlay
          title="Seleziona fonte"
          options={candidates.map((c) => ({
            id: c.providerTitleId,
            label: `${c.title}${c.year ? ` (${c.year})` : ''}`,
            selected: false,
          }))}
          onSelect={(id) => {
            const c = candidates.find((x) => x.providerTitleId === id);
            if (c) void DetailStore.confirmCandidate(c);
          }}
          onClose={DetailStore.closePicker}
        />
      )}

      {msgOpen.value && resolveMessage && (
        <div class="overlay-scrim">
          <div class="overlay-card">
            <div class="overlay-title">{strings.titleUnavailable}</div>
            <div class="overlay-message">{resolveMessage}</div>
            <Focusable
              focusable={false}
              focusKey="detail-msg-dialog"
              trackChildren
              saveLastFocusedChild
              isFocusBoundary
              focusBoundaryDirections={['up', 'down', 'left', 'right']}
              className="overlay-actions"
            >
              <Focusable
                fill
                ring
                forceFocus
                onSelect={() => {
                  DetailStore.resolveMessage.value = null;
                  msgOpen.value = false;
                }}
                className="btn-confirm"
              >
                <span>OK</span>
              </Focusable>
            </Focusable>
          </div>
        </div>
      )}
    </div>
  );
}
