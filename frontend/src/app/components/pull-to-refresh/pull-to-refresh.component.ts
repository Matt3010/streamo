import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';

// Distance the user must drag past the rest position before releasing
// triggers a refresh. Tuned to feel like Twitter/Instagram on iOS.
const TRIGGER_PX = 70;
// Cap how far the indicator can travel — keeps the rubber-band feel
// without letting users yank the icon halfway down the screen.
const MAX_PULL_PX = 110;
// Rubber-band exponent: actual visible distance = raw^EASE_POWER. <1
// makes the indicator lag the finger so the gesture feels resistant.
const EASE_POWER = 0.65;
// We treat the gesture as a vertical pull only when |dy| > |dx| * this.
// Stops accidental fires while horizontally swiping a card-row.
const VERTICAL_INTENT_RATIO = 1.4;
// Tiny haptic blip when the user crosses TRIGGER_PX while still dragging.
// Confirms "release now will refresh" without buzzing on every micro-move.
const HAPTIC_THRESHOLD_REACHED_MS = 12;
// A slightly longer pulse on release-to-refresh — the "commit" feedback.
const HAPTIC_COMMIT_MS = 22;

@Component({
  selector: 'app-pull-to-refresh',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ptr-indicator"
         [class.visible]="pullPx() > 0 || refreshing()"
         [class.ready]="reached()"
         [class.spin]="refreshing()"
         [style.transform]="transform()">
      <span class="ptr-dot" [style.transform]="'scale(' + dotScale() + ')'"></span>
    </div>
  `,
  styleUrl: './pull-to-refresh.component.css'
})
export class PullToRefreshComponent {
  protected readonly pullPx = signal(0);
  protected readonly refreshing = signal(false);
  protected readonly reached = computed(() => this.pullPx() >= TRIGGER_PX);
  // The AIR mark: a white pill with a red dot that grows from 0 to its
  // full size as the user pulls. The brand identity reads at a glance
  // without leaning on a generic refresh glyph.
  protected readonly dotScale = computed(() => {
    if (this.refreshing()) return 1;
    return Math.min(1, this.pullPx() / TRIGGER_PX);
  });
  protected readonly transform = computed(() => {
    const px = this.refreshing() ? TRIGGER_PX : this.pullPx();
    return `translateY(${px * 0.7}px)`;
  });

  private startY = 0;
  private startX = 0;
  private tracking = false;
  private locked = false;
  private hapticFired = false;

  constructor() {
    if (typeof window === 'undefined' || !('ontouchstart' in window)) return;
    if (navigator.maxTouchPoints <= 0) return;

    const start = (e: TouchEvent) => this.onStart(e);
    const move = (e: TouchEvent) => this.onMove(e);
    const end = () => this.onEnd();
    // If the page is hidden (Control Center pulled down, app switched, etc.)
    // mid-refresh, the location.reload() never actually fires. Coming back
    // would otherwise show a perma-stuck "spinning" indicator. Clear on
    // visibility return — same idea as a defensive timeout, but tied to a
    // real user-relevant event.
    const visibility = () => {
      if (document.visibilityState === 'visible') this.fullReset();
    };

    // touchstart is passive so we never block native scroll initiation.
    // touchmove can't be passive because we need preventDefault() once
    // we've decided the gesture is ours.
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
    document.addEventListener('visibilitychange', visibility);

    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
      document.removeEventListener('visibilitychange', visibility);
    });
  }

  private onStart(event: TouchEvent): void {
    // Defensive cleanup before any new gesture: iOS can swallow touchend
    // (multi-touch, Control Center swipe, edge gestures) and leave the
    // indicator hovering at a partial pullPx. Any new finger-down is a
    // good moment to wipe stale state. Skipped while genuinely refreshing
    // so we don't yank away the spinner mid-reload.
    if (!this.refreshing() && this.pullPx() > 0) this.reset();

    if (this.refreshing()) return;
    // Only arm the gesture when the page is already at the top —
    // otherwise the user is mid-scroll and we don't want to interfere.
    if (window.scrollY > 0) {
      this.tracking = false;
      return;
    }
    // Don't arm if the touch originated inside an overlay (popover, modal).
    // Those are position:fixed so scrolling inside them leaves the body
    // scrollY at 0; without this guard, scrolling the bell list would
    // trigger the refresh indicator.
    if (this.touchInsideOverlay(event.target)) {
      this.tracking = false;
      return;
    }
    const t = event.touches[0];
    if (!t) return;
    this.startY = t.clientY;
    this.startX = t.clientX;
    this.tracking = true;
    this.locked = false;
    this.hapticFired = false;
  }

  private touchInsideOverlay(target: EventTarget | null): boolean {
    let el = target instanceof Element ? target : null;
    while (el && el !== document.body) {
      const pos = window.getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
      el = el.parentElement;
    }
    return false;
  }

  private onMove(event: TouchEvent): void {
    if (!this.tracking || this.refreshing()) return;
    const t = event.touches[0];
    if (!t) return;
    const dy = t.clientY - this.startY;
    const dx = t.clientX - this.startX;

    // Ignore upward pulls and gestures that started at the top but
    // immediately scrolled into content (scrollY left 0).
    if (dy <= 0 || window.scrollY > 0) {
      this.tracking = false;
      this.reset();
      return;
    }

    // Discriminate vertical-pull from horizontal-swipe early. The
    // VERTICAL_INTENT_RATIO biases toward "let horizontal scroll win"
    // when the gesture is ambiguous, since horizontal card-rows are
    // far more common than mistaken pull-to-refreshes.
    if (!this.locked) {
      if (Math.abs(dx) > Math.abs(dy)) {
        this.tracking = false;
        return;
      }
      if (Math.abs(dy) < 8) return; // not enough delta yet to commit
      if (Math.abs(dy) < Math.abs(dx) * VERTICAL_INTENT_RATIO) {
        this.tracking = false;
        return;
      }
      this.locked = true;
    }

    // Block the browser's native overscroll once we've locked the
    // gesture — otherwise iOS shows its own rubber-band underneath ours.
    event.preventDefault();

    const eased = Math.pow(dy, EASE_POWER) * 4;
    const clamped = Math.min(eased, MAX_PULL_PX);
    this.pullPx.set(clamped);

    if (!this.hapticFired && clamped >= TRIGGER_PX) {
      this.hapticFired = true;
      this.vibrate(HAPTIC_THRESHOLD_REACHED_MS);
    }
  }

  private onEnd(): void {
    if (!this.tracking) return;
    this.tracking = false;
    const shouldRefresh = this.pullPx() >= TRIGGER_PX;
    if (shouldRefresh) {
      this.vibrate(HAPTIC_COMMIT_MS);
      this.refreshing.set(true);
      // Keep the spinner visible for a beat so the user sees acknowledgement
      // before the page actually reloads. 220ms matches the CSS spring.
      setTimeout(() => window.location.reload(), 220);
    } else {
      this.reset();
    }
  }

  private reset(): void {
    this.pullPx.set(0);
    this.locked = false;
    this.hapticFired = false;
  }

  private fullReset(): void {
    this.tracking = false;
    this.refreshing.set(false);
    this.reset();
  }

  private vibrate(ms: number): void {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    try { navigator.vibrate(ms); } catch { /* not all browsers permit */ }
  }
}
