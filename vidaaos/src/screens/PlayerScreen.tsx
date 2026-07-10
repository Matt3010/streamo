// Player screen: owns the <video> + frozen-frame canvas, wires video events to
// PlayerStore signals, and runs the root key handler implementing the two-mode
// D-pad logic (mirror of TvPlayerScreen.onPreviewKeyEvent). Scrub is owned here
// in both modes; L/R navigates between buttons only when controls are visible,
// the seekbar is NOT focused, and no scrub is in progress.
import { useEffect, useRef } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import type { VNode } from 'preact';
import Hls from 'hls.js';
import { Focusable } from '../spatial/Focusable';
import { PlayerStore } from '../player/PlayerStore';
import { Scrubber } from '../player/Scrubber';
import { FrozenFrame } from '../player/FrozenFrame';
import { ControlsOverlay } from '../player/ControlsOverlay';
import { SettingsOverlay } from '../player/SettingsOverlay';
import { pauseSpatial, resumeSpatial } from '../spatial/SpatialRoot';
import { pushBackHandler } from '../router/BackHandler';
import { useNav } from '../router/Router';
import { setFocus, setKeyMap } from '@noriginmedia/norigin-spatial-navigation-core';
import { strings } from '../i18n/strings';
import type { PlayerRoute } from '../router/routes';

export function PlayerScreen({ route }: { route: PlayerRoute }): VNode {
  const { navigate, goBack } = useNav();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frozenRef = useRef<FrozenFrame | null>(null);
  const scrubberRef = useRef<Scrubber | null>(null);

  // --- attach hls + video once ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    PlayerStore.reset();
    PlayerStore.attach(video);
    if (canvasRef.current) frozenRef.current = new FrozenFrame(canvasRef.current, video);
    PlayerStore.onNavNext = (r) => {
      PlayerStore.saveProgressFinal();
      navigate(r);
    };
    return () => {
      PlayerStore.detach();
      frozenRef.current?.destroy();
      scrubberRef.current?.destroy();
      PlayerStore.onNavNext = null;
    };
  }, []);

  // --- (re)load when the route changes (next/prev episode reuses this screen) ---
  useEffect(() => {
    PlayerStore.load(route);
  }, [route.tmdbId, route.mediaType, route.resumeSeason, route.resumeEpisode]);

  // --- scrubber (re)created per load; callbacks read the live video element ---
  const scrubWasPlaying = useRef(false);
  useEffect(() => {
    const video = videoRef.current!;
    scrubberRef.current = new Scrubber({
      positionMs: () => (video.currentTime || 0) * 1000,
      durationMs: () => (video.duration || 0) * 1000,
      onPending: (ms, anchorMs) => {
        if (!PlayerStore.scrubbing.value) {
          // Scrub start = Android beginScrub(): freeze the frame and PAUSE, so
          // audio doesn't keep running under the frozen preview; remember
          // whether to resume on commit.
          scrubWasPlaying.current = !video.paused && !PlayerStore.ended.value;
          if (!frozenRef.current?.isVisible) frozenRef.current?.capture();
          video.pause();
        }
        PlayerStore.pendingSeekMs.value = ms;
        PlayerStore.scrubAnchorMs.value = anchorMs;
        PlayerStore.scrubbing.value = true;
      },
      onCommit: (ms) => {
        // Android commitScrubTo(): one absolute seek, resume if it was playing.
        PlayerStore.seekToSec(ms / 1000);
        PlayerStore.scrubbing.value = false;
        PlayerStore.scrubAnchorMs.value = -1;
        if (scrubWasPlaying.current) {
          PlayerStore.ended.value = false;
          void video.play().catch(() => {});
        }
      }
    });
    return () => scrubberRef.current?.destroy();
  }, [route.tmdbId, route.mediaType, route.resumeSeason, route.resumeEpisode]);

  // --- video element event wiring → store signals ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Contiguous buffered end from the current position (Android bufferedPosition).
    const updateBuffered = () => {
      // Ignore late events from the episode that was just replaced. load()
      // resets the timeline while provider resolution is still in progress.
      if (PlayerStore.state.value !== 'ready') return;
      const t = video.currentTime || 0;
      let buf = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= t + 0.5 && t <= video.buffered.end(i)) {
          buf = video.buffered.end(i);
          break;
        }
      }
      PlayerStore.bufferedSec.value = buf;
    };
    const onTime = () => {
      if (PlayerStore.state.value !== 'ready') return;
      PlayerStore.positionSec.value = video.currentTime || 0;
      PlayerStore.durationSec.value = video.duration || 0;
      updateBuffered();
      PlayerStore.saveProgress();
      // seek landed: clear pending (store AND scrubber — a stale scrubber
      // pendingMs would anchor the NEXT scrub at the old seek target) + frozen
      // frame, when close enough. Never mid-scrub: scrubbing near the live
      // position must not tear down the preview.
      const pending = PlayerStore.pendingSeekMs.value;
      if (
        !PlayerStore.scrubbing.value &&
        pending >= 0 &&
        Math.abs(video.currentTime * 1000 - pending) < 2000
      ) {
        PlayerStore.clearPending();
        scrubberRef.current?.clearPending();
        if (!PlayerStore.buffering.value) frozenRef.current?.hide();
      }
    };
    const onPlay = () => {
      PlayerStore.paused.value = false;
      PlayerStore.ended.value = false;
      PlayerStore.scheduleAutoHide();
      if (!PlayerStore.scrubbing.value && !PlayerStore.buffering.value) frozenRef.current?.hide();
    };
    const onPause = () => {
      PlayerStore.paused.value = true;
      PlayerStore.scheduleAutoHide();
    };
    const onWaiting = () => {
      PlayerStore.buffering.value = true;
      frozenRef.current?.capture();
    };
    const onPlaying = () => {
      PlayerStore.buffering.value = false;
      PlayerStore.scheduleAutoHide(); // buffering pinned the controls; restart the timer
      if (!PlayerStore.scrubbing.value) frozenRef.current?.hide();
    };
    const onSeeking = () => {
      if (!PlayerStore.scrubbing.value) frozenRef.current?.capture();
    };
    const onSeeked = () => {
      // Seeking away from the end leaves the ended state (Android exits
      // STATE_ENDED on seek): the transport swaps Replay back to Play/Pause.
      PlayerStore.ended.value = video.ended;
      if (!PlayerStore.scrubbing.value && !PlayerStore.buffering.value) frozenRef.current?.hide();
    };
    const onEnded = () => {
      PlayerStore.ended.value = true;
      PlayerStore.paused.value = true;
      PlayerStore.saveProgressFinal();
      PlayerStore.showControls();
      // Android focuses the Replay button when playback ends (rAF: wait for the
      // pl-replay Focusable to render in place of pl-play).
      requestAnimationFrame(() => setFocus('pl-replay'));
    };
    const onRateChange = () => {
      PlayerStore.speed.value = video.playbackRate;
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('progress', updateBuffered);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ended', onEnded);
    video.addEventListener('ratechange', onRateChange);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('progress', updateBuffered);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('ratechange', onRateChange);
    };
  }, []);

  // --- focus mode: pause spatial when immersive, resume + focus seekbar/settings when visible ---
  // Only steal focus on the hidden→visible transition. Re-running setFocus on
  // every controlsVisible signal tick rips focus away from play/skip buttons
  // whenever controls re-show, making them unfocusable.
  const prevControlsVisible = useRef(false);
  const prevSettingsOpen = useRef(false);
  useSignalEffect(() => {
    const vis = PlayerStore.controlsVisible.value;
    const settings = PlayerStore.settingsOpen.value;
    if (settings) {
      resumeSpatial();
      if (!prevSettingsOpen.current) setFocus('settings-panel');
      prevSettingsOpen.current = true;
      prevControlsVisible.current = vis;
      return;
    }
    // Settings just closed: its Focusables unmounted with focus inside them, so
    // refocus the seekbar (Android refocuses it via LaunchedEffect(showSettings)).
    const settingsJustClosed = prevSettingsOpen.current;
    prevSettingsOpen.current = false;
    if (vis) {
      resumeSpatial();
      if (!prevControlsVisible.current || settingsJustClosed) setFocus('pl-seek');
    } else {
      pauseSpatial();
    }
    prevControlsVisible.current = vis;
  });

  useEffect(() => () => resumeSpatial(), []);

  // --- Back handler: scrub→commit, controls→hide, immersive→exit ---
  useEffect(() => {
    const off = pushBackHandler(() => {
      if (PlayerStore.settingsOpen.value) return false; // SettingsOverlay's handler wins
      if (PlayerStore.scrubbing.value) {
        scrubberRef.current?.commit();
        return true;
      }
      if (PlayerStore.controlsVisible.value) {
        PlayerStore.hideControls();
        return true;
      }
      PlayerStore.saveProgressFinal();
      goBack();
      return true;
    });
    return off;
  }, []);

  // --- root key handler (capture): two-mode D-pad + scrub ---
  useEffect(() => {
    // ponytail: the VIDAA remote's OK button sends Space (keyCode 32), not Enter.
    // Norigin's default enter map is [13, 'Enter'], so Space wouldn't fire
    // onEnterPress on the focused button → OK activated nothing (skip/restore).
    // Add Space to the enter map while the player is mounted (no text inputs
    // here, so Space-as-OK is safe); restore on unmount.
    setKeyMap({ enter: [13, 'Enter', 32, 'Space'] });

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // Router already handled Escape/Back.
      const s = PlayerStore;
      if (s.settingsOpen.value) return; // modal + Norigin handle
      const code = e.code;
      const isL = code === 'ArrowLeft';
      const isR = code === 'ArrowRight';

      // --- L/R: scrub when immersive / seekbar-focused / already scrubbing; else navigate ---
      if (isL || isR) {
        // ACTION_UP ignored for scrub; consume only if scrubbing so UP doesn't reach focus nav.
        if (e.type === 'keyup') {
          if (s.scrubbing.value) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
        const dir = isR ? 1 : -1;
        const isRepeat = e.repeat;
        if (s.scrubbing.value) {
          scrubberRef.current?.onKeyDown(dir, isRepeat);
        } else if (!s.controlsVisible.value) {
          s.showControls();
          scrubberRef.current?.onKeyDown(dir, isRepeat);
        } else if (s.seekbarFocused.value) {
          scrubberRef.current?.onKeyDown(dir, isRepeat);
        } else {
          // a button is focused → L/R navigates between buttons; let Norigin handle
          s.scheduleAutoHide();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (e.type === 'keyup') return;

      // non-L/R during scrub → commit first, then process.
      if (s.scrubbing.value) scrubberRef.current?.commit();

      // Dedicated play/pause key: toggles in ANY mode (mirrors Android
      // KEYCODE_MEDIA_PLAY_PAUSE — a separate remote key from OK).
      if (code === 'MediaPlayPause') {
        // ponytail: ignore autorepeat — holding the key must not toggle
        // play/pause on every repeat tick (play→pause→play…). Nav keys (Up/Down/
        // L/R) keep their repeat (fast scroll/scrub); activation keys don't.
        if (e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        s.togglePlay();
        if (!s.controlsVisible.value) s.showControls();
        else s.scheduleAutoHide();
        return;
      }

      // OK button = Enter / NumpadEnter / Space (VIDAA OK sends Space). Mirrors
      // Android DPAD_CENTER/ENTER: seekbar → toggle play (bar is display-only),
      // button → activate via Norigin onEnterPress, immersive → reveal controls.
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
        // ponytail: ignore autorepeat — holding OK must not fire onEnterPress on
        // every repeat tick (else it skips episodes continuously). stopPropagation
        // (capture) prevents Norigin's bubble onEnterPress from firing on repeats;
        // the initial keydown (e.repeat=false) still falls through to activate.
        if (e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (s.controlsVisible.value && s.seekbarFocused.value) {
          e.preventDefault();
          e.stopPropagation();
          s.togglePlay();
          s.scheduleAutoHide();
          return;
        }
        if (!s.controlsVisible.value) {
          e.preventDefault();
          e.stopPropagation();
          s.showControls();
          return;
        }
        // a button is focused → let Norigin activate it (onEnterPress → onSelect)
        s.scheduleAutoHide();
        return;
      }

      if (code === 'ArrowUp' || code === 'ArrowDown') {
        if (!s.controlsVisible.value) {
          e.preventDefault();
          e.stopPropagation();
          s.showControls();
          return;
        }
        s.scheduleAutoHide();
        return; // Norigin moves focus between rows
      }

      // any other key: reveal if immersive, else reset auto-hide
      if (!s.controlsVisible.value) s.showControls();
      else s.scheduleAutoHide();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      setKeyMap({ enter: [13, 'Enter'] });
    };
  }, []);

  // --- reveal controls when a source becomes ready ---
  // Read ONLY state: reading controlsVisible here re-runs the effect on every
  // auto-hide and re-shows the controls immediately → they never stay hidden.
  useSignalEffect(() => {
    if (PlayerStore.state.value === 'ready') PlayerStore.showControls();
  });

  const aspectStyle =
    PlayerStore.aspect.value === 'cover'
      ? { 'object-fit': 'cover' as const }
      : PlayerStore.aspect.value === 'zoom'
        ? { 'object-fit': 'cover' as const, transform: 'scale(1.15)' }
        : { 'object-fit': 'contain' as const };

  return (
    <div class="player-root">
      <video
        ref={videoRef as any}
        class="player-video"
        style={aspectStyle}
        playsinline
        autoplay
      />
      <canvas ref={canvasRef as any} class="frozen-frame" style={{ display: 'none' }} />

      {PlayerStore.state.value === 'loading' ||
      (PlayerStore.buffering.value && PlayerStore.state.value === 'ready') ? (
        <div class="player-buffer-spinner">
          <div class="player-spinner" />
        </div>
      ) : null}

      {PlayerStore.state.value === 'error' ? (
        <div class="player-error">
          <div>{PlayerStore.errorMessage.value ?? strings.streamError}</div>
          <Focusable
            focusKey="pl-exit"
            ring
            fill
            className="retry-btn"
            onSelect={() => {
              PlayerStore.saveProgressFinal();
              goBack();
            }}
          >
            {strings.exitPlayer}
          </Focusable>
        </div>
      ) : null}

      <ControlsOverlay />
      {PlayerStore.settingsOpen.value ? <SettingsOverlay /> : null}
    </div>
  );
}
