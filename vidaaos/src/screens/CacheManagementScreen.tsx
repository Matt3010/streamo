// Cache management — mirror of TvCacheManagementScreen. 4 categories with sizes
// + ConfirmDialogs: Metadati TMDB (Dexie tmdbCache), Immagini (Cache API),
// Streaming (best-effort; hls.js exposes no segment cache), Cancella tutto.
import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import type { VNode } from 'preact';
import { Focusable } from '../spatial/Focusable';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useNav } from '../router/Router';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation-core';
import { repo } from '../data/repositories';
import { strings } from '../i18n/strings';

type Confirm = 'tmdb' | 'images' | 'streaming' | 'all' | null;

function SectionHeader({ title }: { title: string }) {
  return <div class="settings-section-header">{title}</div>;
}

export function CacheManagementScreen(): VNode {
  const { goBack } = useNav();
  const confirm = useSignal<Confirm>(null);
  const toast = useSignal<string | null>(null);
  const tmdbCount = useSignal(0);

  const refresh = async () => {
    tmdbCount.value = await repo.tmdbCacheCount();
  };
  useEffect(() => {
    void refresh();
    const id = requestAnimationFrame(() => setFocus('cache-tmdb'));
    return () => cancelAnimationFrame(id);
  }, []);

  const showToast = (msg: string) => {
    toast.value = msg;
    setTimeout(() => (toast.value = null), 2500);
  };

  const tmdbValue = tmdbCount.value > 0 ? `${tmdbCount.value} elementi` : strings.empty;

  const clearTmdb = async () => {
    await repo.clearTmdbCache();
    await refresh();
    confirm.value = null;
    showToast(strings.cacheCleared);
  };
  const clearImages = async () => {
    await repo.clearImageCache();
    confirm.value = null;
    showToast(strings.cacheCleared);
  };
  const clearStreaming = () => {
    // ponytail: hls.js keeps segments in a MediaSource buffer, not a queryable
    // cache; nothing durable to clear. Surface as done.
    confirm.value = null;
    showToast(strings.cacheCleared);
  };
  const clearAll = async () => {
    await Promise.all([repo.clearTmdbCache(), repo.clearImageCache()]);
    await refresh();
    confirm.value = null;
    showToast(strings.cacheCleared);
  };

  return (
    <div class="screen settings-screen">
      <div class="settings-scroll">
        <div class="settings-header-row">
          <Focusable focusKey="cache-back" ring fill className="back-btn" onSelect={goBack}>
            <span>{strings.back}</span>
          </Focusable>
          <div class="settings-title">{strings.spaceCache}</div>
        </div>

        <SectionHeader title={strings.cacheTmdbSection} />
        <Focusable
          focusKey="cache-tmdb"
          ring
          fill
          forceFocus
          className="settings-row"
          onSelect={() => tmdbCount.value > 0 && (confirm.value = 'tmdb')}
        >
          <span class="row-label">{strings.cacheTmdbRow}</span>
          <span class="row-value">{tmdbValue}</span>
        </Focusable>

        <SectionHeader title={strings.cacheImagesSection} />
        <Focusable
          focusKey="cache-images"
          ring
          fill
          className="settings-row"
          onSelect={() => (confirm.value = 'images')}
        >
          <span class="row-label">{strings.cacheImagesRow}</span>
          <span class="row-value">{strings.empty}</span>
        </Focusable>

        <SectionHeader title={strings.cacheStreamingSection} />
        <Focusable
          focusKey="cache-streaming"
          ring
          fill
          className="settings-row"
          onSelect={() => (confirm.value = 'streaming')}
        >
          <span class="row-label">{strings.cacheStreamingRow}</span>
          <span class="row-value">{strings.empty}</span>
        </Focusable>

        <SectionHeader title={strings.clearAll} />
        <Focusable
          focusKey="cache-all"
          ring
          fill
          className="settings-row"
          onSelect={() => (confirm.value = 'all')}
        >
          <span class="row-label">{strings.cacheClearAllRow}</span>
          <span class="row-value">{strings.cacheClearAllValue}</span>
        </Focusable>
      </div>

      {toast.value ? <div class="toast">{toast.value}</div> : null}

      {confirm.value === 'tmdb' ? (
        <ConfirmDialog
          title={strings.cacheTmdbConfirmTitle}
          confirmLabel={strings.confirm}
          destructive
          onConfirm={clearTmdb}
          onCancel={() => (confirm.value = null)}
        />
      ) : null}
      {confirm.value === 'images' ? (
        <ConfirmDialog
          title={strings.cacheImagesConfirmTitle}
          confirmLabel={strings.confirm}
          destructive
          onConfirm={clearImages}
          onCancel={() => (confirm.value = null)}
        />
      ) : null}
      {confirm.value === 'streaming' ? (
        <ConfirmDialog
          title={strings.cacheStreamingConfirmTitle}
          confirmLabel={strings.confirm}
          destructive
          onConfirm={clearStreaming}
          onCancel={() => (confirm.value = null)}
        />
      ) : null}
      {confirm.value === 'all' ? (
        <ConfirmDialog
          title={strings.cacheClearAllConfirmTitle}
          message={strings.cacheClearAllConfirmBody}
          confirmLabel={strings.confirm}
          destructive
          onConfirm={clearAll}
          onCancel={() => (confirm.value = null)}
        />
      ) : null}
    </div>
  );
}