import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { BannerComponent } from '../../ui/banner/banner.component';
import { TmdbService } from '../../services/tmdb.service';

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
        message="Alcune funzioni potrebbero non essere disponibili finché la connessione non torna." />
    } @else if (!tmdb.isReachable()) {
      <app-banner
        variant="warning"
        title="TMDB non è raggiungibile."
        message="Il catalogo potrebbe essere temporaneamente incompleto. Riproveremo automaticamente." />
    }
  `,
  styleUrl: './offline-banner.component.css'
})
export class OfflineBannerComponent {
  private readonly destroyRef = inject(DestroyRef);
  protected readonly tmdb = inject(TmdbService);

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
