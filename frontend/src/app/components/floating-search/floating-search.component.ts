import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { IconComponent } from '../../ui/icon/icon.component';

@Component({
  selector: 'app-floating-search',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showSearch()) {
      @if (searchOpen()) {
        <button type="button" class="search-backdrop" aria-label="Chiudi ricerca" (click)="closeSearch()"></button>
      }
      <section class="search-panel" [class.open]="searchOpen()" aria-label="Ricerca catalogo">
        <button type="button" class="search-intro" (click)="openSearch()">
          <span class="search-badge">
            <app-icon name="search"></app-icon>
          </span>
          <div class="search-copy">
            <p class="search-title">{{ searchOpen() ? 'Cerca nel catalogo' : 'Cerca film e serie' }}</p>
            @if (searchOpen()) {
              <p class="search-hint">Film e serie TV, con i risultati più recenti in cima.</p>
            }
          </div>
        </button>

        @if (searchOpen()) {
          <div class="search-box">
            <label class="search-field" aria-label="Termine di ricerca">
              <app-icon name="search"></app-icon>
              <input
                type="text"
                placeholder="Titolo, film o serie TV"
                [value]="query()"
                (input)="onInput($event)"
                (keydown.enter)="submitSearch()"
                (keydown.escape)="handleEscape()">
              @if (query().trim()) {
                <button type="button" class="clear-btn" aria-label="Cancella ricerca" (click)="clearQuery()">
                  <app-icon name="close"></app-icon>
                </button>
              }
            </label>

            <div class="search-actions">
              <button class="ghost-btn" type="button" (click)="closeSearch()">Chiudi</button>
              <button class="search-btn" type="button" [disabled]="!query().trim()" (click)="submitSearch()">
                <app-icon name="search"></app-icon>
                <span>Cerca</span>
              </button>
            </div>
          </div>
        }
      </section>
    }
  `,
  styleUrl: './floating-search.component.css'
})
export class FloatingSearchComponent {
  private readonly router = inject(Router);

  readonly query = signal('');
  readonly searchOpen = signal(false);

  private readonly nav = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)),
    { initialValue: null }
  );

  protected readonly showSearch = computed<boolean>(() => {
    this.nav();
    const path = this.router.url.split('?')[0] ?? '';
    return /^(\/browse|\/watch|\/search)(?:\/|$)/.test(path);
  });

  protected readonly currentSearchQuery = computed<string>(() => {
    this.nav();
    const tree = this.router.parseUrl(this.router.url);
    return tree.queryParams['q'] ?? '';
  });

  constructor() {
    effect(() => {
      const path = this.router.url.split('?')[0] ?? '';
      const current = this.currentSearchQuery();
      if (/^\/search(?:\/|$)/.test(path)) {
        this.query.set(current);
      }
    });
  }

  protected onInput(ev: Event): void {
    const target = ev.target;
    if (target instanceof HTMLInputElement) this.query.set(target.value);
  }

  protected openSearch(): void {
    const current = this.currentSearchQuery();
    if (current && !this.query().trim()) {
      this.query.set(current);
    }
    this.searchOpen.set(true);
  }

  protected closeSearch(): void {
    this.searchOpen.set(false);
  }

  protected clearQuery(): void {
    this.query.set('');
  }

  protected handleEscape(): void {
    if (this.query().trim()) this.clearQuery();
    else this.closeSearch();
  }

  protected submitSearch(): void {
    const q = this.query().trim();
    if (q) {
      this.searchOpen.set(false);
      void this.router.navigate(['/search'], { queryParams: { q } });
    }
  }
}
