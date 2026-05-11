import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent } from '../../components/card/card.component';
import { IconComponent } from '../../ui/icon/icon.component';
import { AuthService } from '../../services/auth.service';
import { TmdbService } from '../../services/tmdb.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { ToastService } from '../../services/toast.service';
import { WatchlistService } from '../../services/watchlist.service';
import { tmdbToCardItem } from '../../utils/card-item.util';
import { applyWatchlistFlags, setCardWatchlistFlag, toggleCardWatchlist } from '../../utils/card-watchlist.util';
import type { CardItem } from '../../models';

@Component({
  selector: 'app-search-results',
  standalone: true,
  imports: [CardComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-header-back">
        <button class="back-btn" (click)="back()">
          <app-icon name="chevron-left"></app-icon>
          <span>Indietro</span>
        </button>
      </div>
      <h2>{{ headerText() }}</h2>
    </div>

    @if (loading()) {
      <div class="loading"><div class="spinner"></div><p>Cercando...</p></div>
    } @else if (!q().trim()) {
      <div class="empty-state">
        <p class="empty-state-title">Inserisci un termine di ricerca</p>
        <p class="empty-state-hint">Usa la barra in alto per cercare film o serie TV.</p>
      </div>
    } @else if (items().length === 0) {
      <div class="empty-state">
        <p class="empty-state-title">Nessun risultato per «{{ q() }}»</p>
        <p class="empty-state-hint">Prova con un altro titolo.</p>
      </div>
    } @else {
      <div class="content-grid">
        @for (it of items(); track it.tmdb_id + '-' + it.media_type) {
          <app-card
            [item]="it"
            [showWatchlistToggle]="auth.isLoggedIn()"
            (cardClick)="onCardClick($event)"
            (watchlistToggleClick)="onWatchlistToggle($event)" />
        }
      </div>
    }
  `
})
export class SearchResultsComponent {
  protected readonly auth = inject(AuthService);
  private readonly tmdb = inject(TmdbService);
  private readonly router = inject(Router);
  private readonly navSource = inject(NavigationSourceService);
  private readonly toast = inject(ToastService);
  private readonly watchlist = inject(WatchlistService);

  // Route ?q= query param via withComponentInputBinding().
  readonly q = input<string>('');

  protected readonly items = signal<CardItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly headerText = computed(() => `Risultati per "${this.q()}"`);

  private seq = 0;

  constructor() {
    effect(() => {
      const query = this.q().trim();
      if (query) void this.runSearch(query);
      else this.items.set([]);
    });

    effect(() => {
      this.auth.currentUser();
      this.watchlist.tick();
      const current = this.items();
      if (current.length === 0) return;
      void this.syncWatchlistFlags();
    });
  }

  protected back(): void {
    this.navSource.goBack('/browse');
  }

  protected onCardClick(item: CardItem): void {
    void this.router.navigate(['/watch', item.media_type, item.tmdb_id]);
  }

  protected async onWatchlistToggle(item: CardItem): Promise<void> {
    if (!this.auth.isLoggedIn()) return;
    const result = await toggleCardWatchlist(item, this.watchlist);
    this.items.update((items) => setCardWatchlistFlag(items, item, result.inWatchlist));
    this.toast.show(result.message);
  }

  private async runSearch(q: string): Promise<void> {
    const mySeq = ++this.seq;
    this.loading.set(true);
    this.items.set([]);
    const results = await this.tmdb.searchAll(q);
    if (mySeq !== this.seq) return; // newer search superseded this one
    let items = results.map(r => tmdbToCardItem(r, r.media_type === 'tv' ? 'tv' : 'movie', { releaseTextMode: 'upcoming-only' }));
    if (this.auth.isLoggedIn()) {
      items = await this.withWatchlistFlags(items);
      if (mySeq !== this.seq) return;
    }
    this.items.set(items);
    this.loading.set(false);
  }

  private async syncWatchlistFlags(): Promise<void> {
    if (!this.auth.isLoggedIn()) {
      this.items.update((items) => items.map((item) => ({ ...item, inWatchlist: false })));
      return;
    }

    const snapshot = this.items();
    if (snapshot.length === 0) return;
    const updated = await this.withWatchlistFlags(snapshot);
    if (this.items() !== snapshot) return;
    this.items.set(updated);
  }

  private async withWatchlistFlags(items: CardItem[]): Promise<CardItem[]> {
    const list = await this.watchlist.list();
    return applyWatchlistFlags(items, list);
  }
}
