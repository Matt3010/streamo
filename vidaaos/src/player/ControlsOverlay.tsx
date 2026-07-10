// Player controls overlay. Display-only seekbar (D-pad scrub is owned by the
// root key handler, not the bar). Top bar = title + ep subtitle + subtitle
// toggle + settings. Center = prev / play-pause / next (replay on end). Bottom
// = seekbar + time labels + WARP badge + "Prossimo episodio" pill.
import type { VNode } from 'preact';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation-core';
import { Focusable } from '../spatial/Focusable';
import { PlayerStore } from './PlayerStore';
import { strings } from '../i18n/strings';
import { time } from '../util/format';

const svg = (d: string, size = 28): VNode => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
    <path d={d} />
  </svg>
);

// Material Design "filled" icon paths (same glyphs as Icons.Filled.* in
// TvPlayerScreen.kt): PlayArrow, Pause, SkipPrevious, SkipNext, Replay,
// ClosedCaption, Settings.
const PLAY = 'M8 5v14l11-7z';
const PAUSE = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';
const PREV = 'M6 6h2v12H6zm3.5 6 8.5 6V6z';
const NEXT = 'm6 18 8.5-6L6 6v12zM16 6v12h2V6h-2z';
const REPLAY =
  'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z';
const CC =
  'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z';
const GEAR =
  'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z';
const LOCK =
  'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z';
const FAST_FORWARD = 'M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z';
const FAST_REWIND = 'M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z';

export function ControlsOverlay() {
  const pos = PlayerStore.pendingSeekMs.value >= 0
    ? PlayerStore.pendingSeekMs.value / 1000
    : PlayerStore.positionSec.value;
  const dur = PlayerStore.durationSec.value;
  const pct = dur > 0 ? Math.min(100, Math.max(0, (pos / dur) * 100)) : 0;
  const bufPct = dur > 0 ? Math.min(100, Math.max(0, (PlayerStore.bufferedSec.value / dur) * 100)) : 0;
  const showNextPill = PlayerStore.hasNext.value && (dur > 0 && pos >= dur * 0.98);

  // TvSkipIndicator: delta from the scrub anchor, rounded DOWN to 10s blocks so
  // the seconds step while the bar glides smoothly.
  const anchorMs = PlayerStore.scrubAnchorMs.value;
  const deltaMs = PlayerStore.scrubbing.value && anchorMs >= 0 ? PlayerStore.pendingSeekMs.value - anchorMs : null;
  const skipSec = deltaMs !== null ? Math.floor(Math.abs(deltaMs) / 10_000) * 10 : 0;

  return (
    <div class={`player-controls${PlayerStore.controlsVisible.value ? ' visible' : ''}`}>
      {/* Top bar */}
      <div class="player-top">
        <div>
          <div class="player-title">{PlayerStore.title.value}</div>
          {PlayerStore.subtitle.value ? <div class="player-sub">{PlayerStore.subtitle.value}</div> : null}
        </div>
        <div class="player-top-actions">
          <Focusable
            focusKey="pl-cc"
            scale={1.12}
            ring
            fill
            className="circle-btn"
            onSelect={() => PlayerStore.setSubtitle(PlayerStore.subtitleIdx.value >= 0 ? -1 : 0)}
          >
            {svg(CC)}
          </Focusable>
          <Focusable
            focusKey="pl-settings"
            scale={1.12}
            ring
            fill
            className="circle-btn"
            onSelect={() => {
              PlayerStore.settingsOpen.value = true;
            }}
          >
            {svg(GEAR)}
          </Focusable>
        </div>
      </div>

      {/* Center transport */}
      <div class="player-transport">
        <Focusable
          focusKey="pl-prev"
          focusable={PlayerStore.hasPrev.value}
          scale={1.12}
          ring
          fill
          className={`circle-btn md${PlayerStore.hasPrev.value ? '' : ' disabled'}`}
          onSelect={() => { if (PlayerStore.hasPrev.value) void PlayerStore.episodeRoute(-1).then((r) => r && PlayerStore.onNavNext?.(r)); }}
        >
          {svg(PREV, 38)}
        </Focusable>
        {PlayerStore.ended.value ? (
          <Focusable focusKey="pl-replay" scale={1.12} ring fill className="circle-btn lg" onSelect={() => { PlayerStore.seekToSec(0); PlayerStore.togglePlay(); }}>
            {svg(REPLAY, 48)}
          </Focusable>
        ) : (
          <Focusable focusKey="pl-play" scale={1.12} ring fill className="circle-btn lg" onSelect={() => PlayerStore.togglePlay()}>
            {svg(PlayerStore.paused.value ? PLAY : PAUSE, 48)}
          </Focusable>
        )}
        <Focusable
          focusKey="pl-next"
          focusable={PlayerStore.hasNext.value}
          scale={1.12}
          ring
          fill
          className={`circle-btn md${PlayerStore.hasNext.value ? '' : ' disabled'}`}
          onSelect={() => { if (PlayerStore.hasNext.value) void PlayerStore.episodeRoute(1).then((r) => r && PlayerStore.onNavNext?.(r)); }}
        >
          {svg(NEXT, 38)}
        </Focusable>
      </div>

      {/* Skip indicator: ±N seconds bubble, visible for the whole scrub */}
      {deltaMs !== null ? (
        <div class="skip-indicator">
          {svg(deltaMs < 0 ? FAST_REWIND : FAST_FORWARD, 22)}
          <span>{deltaMs < 0 ? `-${skipSec}` : `+${skipSec}`}</span>
        </div>
      ) : null}

      {/* Bottom: seekbar + times + badges */}
      <div class="player-bottom">
        {PlayerStore.warpActive.value ? (
          <div class="warp-badge">{svg(LOCK, 16)}<span>{strings.warpActive}</span></div>
        ) : null}
        {showNextPill ? (
          <Focusable
            focusKey="pl-nextpill"
            ring
            fill
            className="next-pill"
            onSelect={() => void PlayerStore.episodeRoute(1).then((r) => r && PlayerStore.onNavNext?.(r))}
          >
            <span>{strings.nextEpisode}</span>{svg(NEXT, 20)}
          </Focusable>
        ) : null}
        <Focusable
          focusKey="pl-seek"
          className={`seekbar${PlayerStore.seekbarFocused.value ? ' focused' : ''}`}
          onFocus={() => { PlayerStore.seekbarFocused.value = true; }}
          onBlur={() => { PlayerStore.seekbarFocused.value = false; }}
          onSelect={() => {/* display-only; scrub via D-pad L/R */}}
          // ponytail: explicit Up routing. The seekbar is full-width (100%) while
          // the transport buttons are narrow + centered, so Norigin's vertical
          // nav sees no 20%-overlap "adjacent slice" and falls back to a diagonal
          // comparison that weights X distance ×5 — Up then lands on pl-cc/pl-settings
          // (top-right, near the seekbar's corner) instead of the centered transport,
          // making play/skip unreachable. Route Up to the transport center manually.
          onArrowPress={(d) => {
            if (d === 'up') {
              setFocus(PlayerStore.ended.value ? 'pl-replay' : 'pl-play');
              return false;
            }
            return true;
          }}
        >
          <div class="buffer" style={{ width: `${bufPct}%` }} />
          <div class="fill" style={{ width: `${pct}%` }} />
          <div class="thumb" style={{ left: `${pct}%` }} />
        </Focusable>
        <div class="time-labels">
          <span>{time(pos)}</span>
          <span>{time(dur)}</span>
        </div>
      </div>
    </div>
  );
}