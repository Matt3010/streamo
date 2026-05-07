import { Injectable } from '@angular/core';

/**
 * Refcount-based body scroll lock. Multiple overlays can be open at once
 * (e.g. auth modal opening from inside a user-list view) — we only release
 * the lock when the last consumer goes away.
 */
@Injectable({ providedIn: 'root' })
export class BodyScrollLockService {
  private count = 0;

  acquire(): void {
    if (this.count++ === 0) {
      document.body.style.overflow = 'hidden';
    }
  }

  release(): void {
    if (--this.count <= 0) {
      this.count = 0;
      document.body.style.overflow = '';
    }
  }
}
