import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { IconComponent } from '../../ui/icon/icon.component';
import { UiButtonDirective } from '../../ui/ui-button.directive';
import { UiSurfaceDirective } from '../../ui/ui-surface.directive';
import { TmdbService } from '../../services/tmdb.service';
import type { TmdbItem } from '../../models';

const RECENTS_KEY = 'streamo.search.recent';
const RECENTS_LIMIT = 8;
const SUGGESTION_LIMIT = 6;
const SUGGESTION_DEBOUNCE_MS = 220;
const THUMB_BASE = 'https://image.tmdb.org/t/p/w92';

@Component({
  selector: 'app-floating-search',
  standalone: true,
  imports: [IconComponent, UiButtonDirective, UiSurfaceDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showSearch()) {
      @if (searchOpen()) {
        <button type="button" class="search-backdrop" aria-label="Chiudi ricerca" (click)="closeSearch()"></button>
      }
      <section class="search-panel" [class.open]="searchOpen()" aria-label="Ricerca catalogo">
        <button uiSurface="row" type="button" (click)="openSearch()">
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
            <div class="search-row">
              <label class="search-field" aria-label="Termine di ricerca">
                <app-icon name="search"></app-icon>
                <input
                  #searchInput
                  type="text"
                  placeholder="Titolo, film o serie TV"
                  [value]="query()"
                  (input)="onInput($event)"
                  (keydown.enter)="submitSearch()"
                  (keydown.escape)="handleEscape()">
                @if (query().trim()) {
                  <button uiButton="icon-subtle" type="button" aria-label="Cancella ricerca" (click)="clearQuery()">
                    <app-icon name="close"></app-icon>
                  </button>
                }
              </label>

              <div class="search-actions">
                <button uiButton="primary" uiButtonSize="compact" type="button" [disabled]="!query().trim()" (click)="submitSearch()">
                  <app-icon name="search"></app-icon>
                  <span>Cerca</span>
                </button>
                <button uiButton="ghost" uiButtonSize="compact" type="button" (click)="closeSearch()">Chiudi</button>
              </div>
            </div>

            @if (showSuggestions()) {
              <ul class="search-suggestions" role="listbox">
                @for (item of suggestions(); track item.media_type + '-' + item.id) {
                  <li>
                    <button uiSurface="row" type="button" class="search-suggestion" (click)="openSuggestion(item)">
                      @if (item.poster_path) {
                        <img class="search-suggestion-thumb" [src]="thumbUrl(item.poster_path)" alt="" loading="lazy">
                      } @else {
                        <span class="search-suggestion-thumb search-suggestion-thumb-fallback" aria-hidden="true">
                          <app-icon [name]="item.media_type === 'tv' ? 'tv' : 'film'"></app-icon>
                        </span>
                      }
                      <span class="search-suggestion-copy">
                        <span class="search-suggestion-title">{{ suggestionTitle(item) }}</span>
                        <span class="search-suggestion-meta">
                          <span class="search-suggestion-type">{{ item.media_type === 'tv' ? 'Serie TV' : 'Film' }}</span>
                          @if (suggestionYear(item); as year) {
                            <span class="search-suggestion-year">{{ year }}</span>
                          }
                        </span>
                      </span>
                    </button>
                  </li>
                }
              </ul>
            } @else if (showRecents()) {
              <div class="search-recents">
                <div class="search-recents-header">
                  <span class="search-recents-title">Recenti</span>
                </div>
                <ul role="listbox">
                  @for (term of recents(); track term) {
                    <li>
                      <button uiSurface="row" type="button" class="search-recent" (click)="useRecent(term)">
                        <span class="search-recent-icon" aria-hidden="true">
                          <app-icon name="history"></app-icon>
                        </span>
                        <span class="search-recent-text">{{ term }}</span>
                        <button uiButton="icon-subtle" type="button" class="search-recent-remove"
                                aria-label="Rimuovi dalla cronologia"
                                (click)="removeRecent(term, $event)">
                          <app-icon name="close"></app-icon>
                        </button>
                      </button>
                    </li>
                  }
                </ul>
              </div>
            }
          </div>
        }
      </section>
    }
  `,
  styleUrl: './floating-search.component.css'
})
export class FloatingSearchComponent {
  private readonly router = inject(Router);
  private readonly tmdb = inject(TmdbService);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly query = signal('');
  readonly searchOpen = signal(false);
  protected readonly suggestions = signal<TmdbItem[]>([]);
  protected readonly recents = signal<string[]>(loadRecents());

  private fetchSeq = 0;

  private readonly nav = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)),
    { initialValue: null }
  );

  protected readonly showSearch = computed<boolean>(() => {
    this.nav();
    const path = this.router.url.split('?')[0] ?? '';
    return /^(\/browse|\/watch|\/search)(?:\/|$)/.test(path);
  });

  protected readonly showSuggestions = computed(() =>
    this.query().trim().length >= 2 && this.suggestions().length > 0
  );

  protected readonly showRecents = computed(() =>
    !this.query().trim() && this.recents().length > 0
  );

  constructor() {
    effect(() => {
      if (!this.searchOpen()) return;
      const input = this.searchInput()?.nativeElement;
      if (!input) return;
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
    });

    /* Debounced typeahead. Cancels in-flight timers when the query
     * changes; fetchSeq is bumped on every effect transition so a
     * stale response that resolves late cannot overwrite a fresher
     * (or already-cleared) suggestions signal. */
    effect((onCleanup) => {
      const q = this.query().trim();
      if (q.length < 2) {
        this.suggestions.set([]);
        this.fetchSeq++;
        return;
      }
      const handle = setTimeout(() => {
        void this.fetchSuggestions(q);
      }, SUGGESTION_DEBOUNCE_MS);
      onCleanup(() => {
        clearTimeout(handle);
        this.fetchSeq++;
      });
    });
  }

  protected onInput(ev: Event): void {
    const target = ev.target;
    if (target instanceof HTMLInputElement) this.query.set(target.value);
  }

  protected openSearch(): void {
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
    if (!q) return;
    this.pushRecent(q);
    this.searchOpen.set(false);
    this.query.set('');
    this.suggestions.set([]);
    void this.router.navigate(['/search'], { queryParams: { q } });
  }

  protected openSuggestion(item: TmdbItem): void {
    const type = item.media_type;
    if (type !== 'movie' && type !== 'tv') return;
    this.pushRecent(this.query().trim());
    this.searchOpen.set(false);
    this.query.set('');
    this.suggestions.set([]);
    void this.router.navigate(['/watch', type, item.id]);
  }

  protected useRecent(term: string): void {
    this.query.set(term);
    this.submitSearch();
  }

  protected removeRecent(term: string, event: Event): void {
    event.stopPropagation();
    this.recents.update((current) => {
      const next = current.filter((r) => r !== term);
      persistRecents(next);
      return next;
    });
  }

  protected suggestionTitle(item: TmdbItem): string {
    return item.title ?? item.name ?? 'Senza titolo';
  }

  protected suggestionYear(item: TmdbItem): string | null {
    const raw = item.release_date ?? item.first_air_date ?? '';
    const match = raw.match(/^(\d{4})/);
    return match ? match[1] : null;
  }

  protected thumbUrl(path: string): string {
    return `${THUMB_BASE}${path}`;
  }

  private async fetchSuggestions(q: string): Promise<void> {
    const seq = ++this.fetchSeq;
    const results = await this.tmdb.searchAll(q);
    if (seq !== this.fetchSeq) return;
    this.suggestions.set(results.slice(0, SUGGESTION_LIMIT));
  }

  private pushRecent(term: string): void {
    if (!term) return;
    this.recents.update((current) => {
      const next = [term, ...current.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, RECENTS_LIMIT);
      persistRecents(next);
      return next;
    });
  }
}

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .slice(0, RECENTS_LIMIT);
  } catch {
    return [];
  }
}

function persistRecents(items: string[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable */
  }
}
