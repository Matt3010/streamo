// Frozen-frame overlay: capture the current video frame to a canvas so the
// surface doesn't go black during scrub/seek/buffer. Mirror of the Android
// frozen-frame behavior. The screen owns the <canvas> element; this helper
// draws into it and toggles visibility.

export class FrozenFrame {
  private shown = false;

  constructor(private canvas: HTMLCanvasElement, private video: HTMLVideoElement) {}

  /** Capture the current frame and show the overlay. Safe to call repeatedly. */
  capture(): void {
    const v = this.video;
    if (!v.videoWidth || !v.videoHeight) return;
    const c = this.canvas;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    try {
      const ctx = c.getContext('2d');
      if (ctx) ctx.drawImage(v, 0, 0, c.width, c.height);
    } catch {
      // ponytail: drawImage can throw on cross-origin taint; the proxy serves
      // same-origin so this shouldn't happen, but never let it break playback.
      return;
    }
    c.style.display = 'block';
    this.shown = true;
  }

  hide(): void {
    if (!this.shown) return;
    this.canvas.style.display = 'none';
    this.shown = false;
  }

  get isVisible(): boolean {
    return this.shown;
  }

  destroy(): void {
    this.hide();
  }
}