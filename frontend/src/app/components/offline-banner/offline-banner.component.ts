import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { BannerComponent } from '../../ui/banner/banner.component';

@Component({
  selector: 'app-offline-banner',
  standalone: true,
  imports: [BannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!isOnline()) {
      <app-banner
        variant="danger"
        title="Sei offline."
        message="Alcune funzioni potrebbero non essere disponibili finche la connessione non torna." />
    }
  `,
  styles: [':host { display: contents; }']
})
export class OfflineBannerComponent {
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isOnline = signal(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  constructor() {
    if (typeof window === 'undefined') {
      return;
    }

    const syncOnlineState = () => this.isOnline.set(navigator.onLine);

    window.addEventListener('online', syncOnlineState);
    window.addEventListener('offline', syncOnlineState);

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('online', syncOnlineState);
      window.removeEventListener('offline', syncOnlineState);
    });
  }
}
