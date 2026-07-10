// Player settings overlay: right-aligned panel that drills into sub-panels
// (subtitles / audio / speed / quality / aspect / server / exit). Mirrors
// TvSettingsOverlay. A layered BackHandler closes the open sub-panel first,
// then the overlay. Focus is pinned inside the panel via Norigin.
import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { Focusable } from '../spatial/Focusable';
import { pushBackHandler } from '../router/BackHandler';
import { PlayerStore } from './PlayerStore';
import { strings } from '../i18n/strings';

type Sub = 'subtitles' | 'audio' | 'speed' | 'quality' | 'aspect' | 'server' | null;

interface Row {
  key: Sub;
  label: string;
  value: () => string;
}

export function SettingsOverlay() {
  const sub = useSignal<Sub>(null);

  useEffect(() => {
    // Back closes the open sub-panel first, then the whole overlay.
    const off = pushBackHandler(() => {
      if (sub.value) {
        sub.value = null;
        return true;
      }
      PlayerStore.settingsOpen.value = false;
      PlayerStore.showControls();
      return true;
    });
    return off;
  }, []);

  const close = () => {
    PlayerStore.settingsOpen.value = false;
    PlayerStore.showControls();
  };

  const rows: Row[] = [
    {
      key: 'subtitles',
      label: strings.subtitles,
      value: () => {
        const i = PlayerStore.subtitleIdx.value;
        if (i < 0) return strings.off;
        return PlayerStore.subtitleTracks.value[i]?.label ?? strings.off;
      }
    },
    {
      key: 'audio',
      label: strings.audio,
      value: () => PlayerStore.audioTracks.value[PlayerStore.audioIdx.value]?.label ?? strings.auto
    },
    { key: 'speed', label: strings.speed, value: () => `${PlayerStore.speed.value}x` },
    {
      key: 'quality',
      label: strings.quality,
      value: () => (PlayerStore.quality.value === 'auto' ? strings.auto : `${PlayerStore.quality.value}p`)
    },
    {
      key: 'aspect',
      label: strings.aspect,
      value: () => {
        const a = PlayerStore.aspect.value;
        return a === 'contain' ? strings.aspectContain : a === 'cover' ? strings.aspectCover : strings.aspectZoom;
      }
    },
    {
      key: 'server',
      label: strings.server,
      value: () => PlayerStore.sourceLabels.value[PlayerStore.sourceIdx.value] ?? ''
    }
  ];

  const renderOptions = (): { label: string; selected: boolean; onPick: () => void }[] => {
    switch (sub.value) {
      case 'subtitles':
        return [
          { label: strings.off, selected: PlayerStore.subtitleIdx.value === -1, onPick: () => PlayerStore.setSubtitle(-1) },
          ...PlayerStore.subtitleTracks.value.map((t) => ({
            label: t.label,
            selected: PlayerStore.subtitleIdx.value === t.id,
            onPick: () => PlayerStore.setSubtitle(t.id)
          }))
        ];
      case 'audio':
        return PlayerStore.audioTracks.value.map((t) => ({
          label: t.label,
          selected: PlayerStore.audioIdx.value === t.id,
          onPick: () => PlayerStore.setAudio(t.id)
        }));
      case 'speed':
        return PlayerStore.SPEEDS.map((sp) => ({
          label: `${sp}x`,
          selected: PlayerStore.speed.value === sp,
          onPick: () => PlayerStore.setSpeed(sp)
        }));
      case 'quality':
        return [
          { label: strings.auto, selected: PlayerStore.quality.value === 'auto', onPick: () => PlayerStore.setQuality('auto') },
          { label: '1080p', selected: PlayerStore.quality.value === '1080', onPick: () => PlayerStore.setQuality('1080') },
          { label: '720p', selected: PlayerStore.quality.value === '720', onPick: () => PlayerStore.setQuality('720') }
        ];
      case 'aspect':
        return [
          { label: strings.aspectContain, selected: PlayerStore.aspect.value === 'contain', onPick: () => PlayerStore.setAspect('contain') },
          { label: strings.aspectCover, selected: PlayerStore.aspect.value === 'cover', onPick: () => PlayerStore.setAspect('cover') },
          { label: strings.aspectZoom, selected: PlayerStore.aspect.value === 'zoom', onPick: () => PlayerStore.setAspect('zoom') }
        ];
      case 'server':
        return PlayerStore.sourceLabels.value.map((lbl, i) => ({
          label: lbl,
          selected: PlayerStore.sourceIdx.value === i,
          onPick: () => PlayerStore.setSource(i)
        }));
      default:
        return [];
    }
  };

  return (
    <div class="settings-overlay">
      <Focusable
        focusable={false}
        focusKey="settings-panel"
        saveLastFocusedChild
        trackChildren
        isFocusBoundary
        focusBoundaryDirections={['up', 'down', 'left', 'right']}
        className="settings-card"
      >
        <div class="overlay-title">{sub.value ? rows.find((r) => r.key === sub.value)?.label : strings.settings}</div>
        {sub.value === null ? (
          <div class="overlay-list">
            {rows.map((r) => (
              <Focusable
                key={r.key}
                focusKey={`set-${r.key}`}
                ring
                fill
                className="overlay-row"
                onSelect={() => {
                  if (r.key === 'server' && PlayerStore.sources.value.length <= 1) return;
                  sub.value = r.key;
                }}
              >
                <span class="row-label">{r.label}</span>
                <span class="row-value">{r.value()}</span>
              </Focusable>
            ))}
            <Focusable focusKey="set-exit" ring fill className="overlay-row" onSelect={close}>
              <span class="row-label">{strings.exitPlayer}</span>
            </Focusable>
          </div>
        ) : (
          <div class="overlay-list">
            {renderOptions().map((o, i) => (
              <Focusable
                key={i}
                focusKey={`set-opt-${i}`}
                ring
                fill
                className={`overlay-row${o.selected ? ' selected' : ''}`}
                onSelect={() => {
                  o.onPick();
                  sub.value = null;
                }}
              >
                <span class="row-label">{o.label}</span>
                {o.selected ? <span class="check">✓</span> : null}
              </Focusable>
            ))}
          </div>
        )}
      </Focusable>
    </div>
  );
}