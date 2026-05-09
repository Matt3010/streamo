import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent } from '../../components/card/card.component';
import { IconComponent } from '../../components/icon/icon.component';
import { TmdbService } from '../../services/tmdb.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import type { CardItem, MediaType, TmdbItem } from '../../models';

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
        @for (it of items(); track it.tmdb_id) {
          <app-card [item]="it" (cardClick)="onCardClick($event)" />
        }
      </div>
    }
  `
})
export class SearchResultsComponent {
  private readonly tmdb = inject(TmdbService);
  private readonly router = inject(Router);
  private readonly navSource = inject(NavigationSourceService);

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
  }

  protected back(): void {
    this.navSource.goBack('/browse');
  }

  protected onCardClick(item: CardItem): void {
    void this.router.navigate(['/watch', item.media_type, item.tmdb_id]);
  }

  private async runSearch(q: string): Promise<void> {
    const mySeq = ++this.seq;
    this.loading.set(true);
    this.items.set([]);
    const results = await this.tmdb.searchAll(q);
    if (mySeq !== this.seq) return; // newer search superseded this one
    this.items.set(results.map(r => tmdbToCard(r)));
    this.loading.set(false);
  }
}

function tmdbToCard(item: TmdbItem): CardItem {
  const dateStr = item.release_date ?? item.first_air_date ?? '';
  const mediaType: MediaType = item.media_type === 'tv' ? 'tv' : 'movie';
  return {
    tmdb_id: item.id,
    media_type: mediaType,
    title: item.title ?? item.name ?? 'Senza titolo',
    poster: item.poster_path ?? null,
    year: dateStr.split('-')[0] ?? '',
    rating: item.vote_average ? item.vote_average.toFixed(1) : ''
  };
}
