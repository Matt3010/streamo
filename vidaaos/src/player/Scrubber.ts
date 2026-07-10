// D-pad scrub state machine. Port of the load-bearing logic in
// TvPlayerScreen.kt. Two key facts that make this non-obvious:
//
// 1. ACTION_UP IS IGNORED. BT/IR remotes fire DOWN/UP per autorepeat tick, so
//    treating keyup as a commit breaks the flow. In the browser we NEVER commit
//    on keyup — only on the SCRUB_IDLE_MS idle timeout. (See memory
//    tv-scrub-commit-on-timeout-not-keyup.)
// 2. HOLD is detected primarily via KeyboardEvent.repeat (the reliable flag);
//    the HOLD_ENGAGE_STREAK gap-based counter is only a fallback for browsers
//    that don't set .repeat.
//
// Commit-by-timeout means: after SCRUB_IDLE_MS with no key events, the pending
// seek is applied to the video. The seekbar rides pendingSeekMs until the
// seek lands (cleared by the screen when |current - pending| < 2000ms).

export const SCRUB_TICK_MS = 16;
export const TAP_SEEK_MS = 10_000;
export const HOLD_ENGAGE_STREAK = 2;
export const SCRUB_IDLE_MS = 600;
// Stop the HOLD ticker this long after the LAST keydown. The ticker animates the
// preview while the D-pad is held; once the user releases, no further keydowns
// arrive, so this keepalive expiry = "released". We can't use keyup as the release
// signal (IR/BT remotes fire DOWN/UP per autorepeat tick — see memory
// tv-scrub-commit-on-timeout-not-keyup), so release is detected by absence of
// keydowns. Must exceed the remote's autorepeat interval (~100-125ms) so the
// ticker doesn't stop mid-hold, and stay below SCRUB_IDLE_MS so the preview
// freezes before the commit lands. ponytail: raise if a given TV repeats slower.
export const HOLD_KEEPALIVE_MS = 150;

// ponytail: rAF/timer accessors that work in both browser and Node (for the
// self-check). Under Node there is no requestAnimationFrame; fall back to
// setTimeout(16) so the ticker logic is still exercised by the demo.
const raf: (cb: FrameRequestCallback) => number =
  typeof requestAnimationFrame !== 'undefined'
    ? requestAnimationFrame
    : (cb) => setTimeout(() => cb(0), SCRUB_TICK_MS) as unknown as number;
const caf: (h: number) => void =
  typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : clearTimeout;

/** Held-duration → scrub speed (seconds-of-content per real second). */
export function scrubSpeedMsPerSec(heldMs: number): number {
  if (heldMs < 500) return 10;
  if (heldMs < 1200) return 25;
  if (heldMs < 2500) return 60;
  if (heldMs < 4500) return 150;
  return 300;
}

export interface ScrubberCallbacks {
  /** Current playback position in ms. */
  positionMs: () => number;
  /** Total duration in ms (clamps the seek). */
  durationMs: () => number;
  /** Fired whenever the preview seek target moves (seekbar rides this).
   *  anchorMs = position at the start of the current scrub "run" (re-anchored on
   *  direction change) — the ±N skip indicator shows pending - anchor. */
  onPending: (ms: number, anchorMs: number) => void;
  /** Fired once when the seek should land on the video element. */
  onCommit: (ms: number) => void;
}

interface ScrubberState {
  direction: 1 | -1 | null;
  streak: number;
  lastKeyDownTs: number;
  holdStartTs: number;
  holdEngaged: boolean;
  pendingMs: number;
  anchorMs: number;
  rafHandle: number | null;
  idleHandle: number | null;
  lastTickTs: number;
}

/**
 * ponytail: the state machine is a plain class (no framework). The screen owns
 * one instance, feeds it keydown events, and clears pendingMs on timeupdate
 * once the seek lands. requestAnimationFrame drives the HOLD acceleration.
 */
export class Scrubber {
  private s: ScrubberState = {
    direction: null,
    streak: 0,
    lastKeyDownTs: 0,
    holdStartTs: 0,
    holdEngaged: false,
    pendingMs: -1,
    anchorMs: -1,
    rafHandle: null,
    idleHandle: null,
    lastTickTs: 0
  };

  constructor(private cb: ScrubberCallbacks) {}

  /** Current preview target (-1 = none; seekbar shows live position). */
  get pendingMs(): number {
    return this.s.pendingMs;
  }

  private clamp(ms: number): number {
    const dur = this.cb.durationMs();
    if (dur > 0) return Math.max(0, Math.min(dur, ms));
    return Math.max(0, ms);
  }

  private anchor(): number {
    // Anchor a fresh scrub from the live position, not a stale pending value,
    // so direction changes re-anchor correctly.
    return this.s.pendingMs >= 0 ? this.s.pendingMs : this.cb.positionMs();
  }

  /** ArrowLeft (-1) / ArrowRight (+1) keydown. isRepeat = KeyboardEvent.repeat.
   *  Mirrors TvPlayerScreen.onScrubKey: HOLD is confirmed via the repeat flag
   *  (fast path) or a streak of short-gap events (fallback for remotes that send
   *  DOWN/UP pairs with repeat=false); long gaps are separate discrete taps. */
  onKeyDown(direction: 1 | -1, isRepeat: boolean): void {
    const now = performance.now();
    const gap = now - this.s.lastKeyDownTs;
    this.s.lastKeyDownTs = now;

    if (this.s.direction === null) {
      // Fresh scrub: anchor at the in-flight commit target if any, else live position.
      this.s.anchorMs = this.anchor();
      this.s.pendingMs = this.clamp(this.s.anchorMs + direction * TAP_SEEK_MS);
      this.s.streak = 0;
      this.s.holdEngaged = false;
      this.s.holdStartTs = 0;
      this.s.direction = direction;
    } else if (this.s.direction !== direction) {
      // Direction change: new "run" — re-anchor the ±N indicator at the CURRENT
      // PREVIEW (not the live position: that would throw away the scrub so far)
      // and reset to TAP semantics. Mirrors Android (scrubStartPositionMs = scrubPositionMs).
      this.stopTicker();
      this.s.holdEngaged = false;
      this.s.streak = 0;
      this.s.holdStartTs = 0;
      this.s.anchorMs = this.s.pendingMs >= 0 ? this.s.pendingMs : this.anchor();
      this.s.pendingMs = this.clamp(this.s.anchorMs + direction * TAP_SEEK_MS);
      this.s.direction = direction;
    } else if (gap < 16) {
      // Same-frame duplicate (some remotes send paired events): ignore, no double jump.
    } else if (isRepeat || gap <= 250) {
      this.s.streak++;
      // With the reliable repeat flag one event is enough; gap-only needs the streak
      // so a quick double tap isn't mistaken for a hold.
      const engage = isRepeat ? 1 : HOLD_ENGAGE_STREAK;
      if (this.s.streak >= engage) {
        if (!this.s.holdEngaged) {
          this.s.holdEngaged = true;
          this.s.holdStartTs = now; // speed ramps from hold entry, not first tap
        }
        this.startTicker();
      } else if (!this.s.holdEngaged) {
        // Still ambiguous (could be a fast double tap): discrete jump.
        this.s.pendingMs = this.clamp(this.s.pendingMs + direction * TAP_SEEK_MS);
      }
    } else {
      // Long gap, no repeat flag = separate discrete tap: jump, reset hold state.
      this.stopTicker();
      this.s.streak = 0;
      this.s.holdEngaged = false;
      this.s.holdStartTs = 0;
      this.s.pendingMs = this.clamp(this.s.pendingMs + direction * TAP_SEEK_MS);
    }

    this.cb.onPending(this.s.pendingMs, this.s.anchorMs);
    this.scheduleCommit();
  }

  private startTicker(): void {
    if (this.s.rafHandle != null) return;
    this.s.lastTickTs = performance.now();
    const tick = () => {
      if (!this.s.holdEngaged || this.s.direction == null) {
        this.s.rafHandle = null;
        return;
      }
      const now = performance.now();
      // Release detection: no keydown for HOLD_KEEPALIVE_MS → user let go of the
      // D-pad. Freeze the preview here (stop advancing pendingMs); the SCRUB_IDLE_MS
      // commit (scheduled by the last onKeyDown) still fires to land the seek.
      // Without this the ticker keeps racing for 600ms after release — and speed
      // keeps accelerating (heldMs grows), so the bar can shoot minutes of content
      // past the point the user wanted.
      if (now - this.s.lastKeyDownTs > HOLD_KEEPALIVE_MS) {
        this.s.rafHandle = null;
        return;
      }
      const dtMs = now - this.s.lastTickTs;
      this.s.lastTickTs = now;
      const heldMs = now - this.s.holdStartTs;
      const speed = scrubSpeedMsPerSec(heldMs); // s-of-content per s
      const deltaMs = (speed * 1000 * dtMs) / 1000; // content-ms advanced in dtMs
      this.s.pendingMs = this.clamp(this.s.pendingMs + this.s.direction * deltaMs);
      this.cb.onPending(this.s.pendingMs, this.s.anchorMs);
      // NOTE: do NOT call scheduleCommit() here. Each tick resets the idle
      // timer (~16ms), so the 600ms commit-by-timeout never fires while the
      // ticker runs → the scrub keeps scrolling forever after the user
      // releases the D-pad. Only onKeyDown (real keypress) reschedules the
      // idle commit; the ticker is purely for smooth preview animation.
      this.s.rafHandle = raf(tick);
    };
    this.s.rafHandle = raf(tick);
  }

  private stopTicker(): void {
    if (this.s.rafHandle != null) caf(this.s.rafHandle);
    this.s.rafHandle = null;
  }

  private scheduleCommit(): void {
    if (this.s.idleHandle != null) clearTimeout(this.s.idleHandle);
    this.s.idleHandle = setTimeout(() => this.commit(), SCRUB_IDLE_MS) as unknown as number;
  }

  /** Apply the pending seek to the video. Called on idle timeout. */
  commit(): void {
    this.stopTicker();
    if (this.s.idleHandle != null) {
      clearTimeout(this.s.idleHandle);
      this.s.idleHandle = null;
    }
    if (this.s.pendingMs >= 0) {
      this.cb.onCommit(this.s.pendingMs);
    }
    // Keep pendingMs so the seekbar holds the target until the seek lands;
    // the screen clears it (clearPending) when |current - pending| < 2000ms.
    this.s.holdEngaged = false;
    this.s.streak = 0;
    this.s.holdStartTs = 0;
  }

  /** Called by the screen once the seek has landed. */
  clearPending(): void {
    this.s.pendingMs = -1;
    this.s.anchorMs = -1;
    this.stopTicker();
    if (this.s.idleHandle != null) {
      clearTimeout(this.s.idleHandle);
      this.s.idleHandle = null;
    }
    this.s.direction = null;
    this.s.holdEngaged = false;
    this.s.streak = 0;
    this.s.holdStartTs = 0;
  }

  /** Hard reset (e.g. on source switch / new episode). */
  reset(): void {
    this.stopTicker();
    if (this.s.idleHandle != null) clearTimeout(this.s.idleHandle);
    this.s = {
      direction: null,
      streak: 0,
      lastKeyDownTs: 0,
      holdStartTs: 0,
      holdEngaged: false,
      pendingMs: -1,
      anchorMs: -1,
      rafHandle: null,
      idleHandle: null,
      lastTickTs: 0
    };
  }

  destroy(): void {
    this.reset();
  }
}

// ponytail: self-check — TAP advances by TAP_SEEK_MS; direction change
// re-anchors from the PREVIEW; double tap = two discrete jumps; the 3rd
// short-gap event (or the repeat flag) engages HOLD. `age()` backdates
// lastKeyDownTs to simulate gaps between key events.
export function demo(): void {
  let pos = 30_000;
  let pending = -1;
  let anchor = -1;
  let committed = -1;
  const dur = 600_000;
  const scrub = new Scrubber({
    positionMs: () => pos,
    durationMs: () => dur,
    onPending: (ms, a) => ((pending = ms), (anchor = a)),
    onCommit: (ms) => (committed = ms)
  });
  const age = (ms: number) => ((scrub as any).s.lastKeyDownTs -= ms);
  // Single TAP right from 30s → +10s = 40s; anchor at the pre-jump position.
  scrub.onKeyDown(1, false);
  console.assert(pending === 40_000, 'tap right +10s', pending);
  console.assert(anchor === 30_000, 'anchor at pre-jump position', anchor);
  // Direction change left re-anchors from the PREVIEW (40s) - 10s = 30s.
  age(100);
  scrub.onKeyDown(-1, false);
  console.assert(pending === 30_000, 'dir change re-anchors from preview', pending);
  console.assert(anchor === 40_000, 'anchor moved to previous preview', anchor);
  // Double tap (short gap) = two discrete jumps, NOT a hold.
  scrub.reset();
  scrub.onKeyDown(1, false);
  age(100);
  scrub.onKeyDown(1, false);
  console.assert(pending === 50_000, 'double tap = +20s', pending);
  console.assert((scrub as any).s.holdEngaged === false, '2nd short-gap tap: not hold yet');
  // 3rd short-gap event reaches the streak → HOLD engages.
  age(100);
  scrub.onKeyDown(1, false);
  console.assert((scrub as any).s.holdEngaged === true, '3rd short-gap event: hold engaged');
  // Long gap between taps = separate discrete jumps, never a hold.
  scrub.reset();
  scrub.onKeyDown(1, false);
  age(400);
  scrub.onKeyDown(1, false);
  age(400);
  scrub.onKeyDown(1, false);
  console.assert(pending === 60_000, 'three slow taps = +30s', pending);
  console.assert((scrub as any).s.holdEngaged === false, 'slow taps never engage hold');
  // Repeat keydown engages hold immediately.
  scrub.reset();
  scrub.onKeyDown(1, false);
  age(100);
  scrub.onKeyDown(1, true);
  console.assert((scrub as any).s.holdEngaged === true, 'repeat engages hold');
  // Commit fires onCommit with the pending value.
  scrub.reset();
  scrub.onKeyDown(1, false);
  scrub.commit();
  console.assert(committed === 40_000, 'commit applies pending', committed);
  console.log('Scrubber.ts demo: OK');
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('Scrubber.ts')) demo();