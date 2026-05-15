import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
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
import { BodyScrollLockService } from '../../services/body-scroll-lock.service';
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
        <button uiSurface="row" type="button"
                [attr.aria-expanded]="searchOpen()"
                aria-controls="floating-search-content"
                (click)="openSearch()">
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
          <div id="floating-search-content" class="search-box">
            <div class="search-row">
              <label class="search-field" aria-label="Termine di ricerca">
                <app-icon name="search"></app-icon>
                <input
                  #searchInput
                  type="text"
                  placeholder="Titolo, film o serie TV"
                  [value]="query()"
                  (input)="onInput($event)"
                  (keydown.enter)="onEnter($event)"
                  (keydown.escape)="handleEscape()"
                  (keydown.arrowDown)="onArrowDown($event)"
                  (keydown.arrowUp)="onArrowUp($event)">
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

            @if (showLoading()) {
              <p class="search-status">Cerco...</p>
            } @else if (showEmpty()) {
              <p class="search-status">Nessun risultato per "{{ query() }}"</p>
            } @else if (showSuggestions()) {
              <ul class="search-suggestions">
                @for (item of suggestions(); track item.media_type + '-' + item.id; let i = $index) {
                  <li>
                    <button uiSurface="row" type="button" class="search-suggestion"
                            [class.is-highlighted]="i === highlighted()"
                            (click)="openSuggestion(item)">
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
                <ul>
                  @for (term of recents(); track term; let i = $index) {
                    <li class="search-recent" [class.is-highlighted]="i === highlighted()">
                      <button uiSurface="row" type="button" class="search-recent-main" (click)="useRecent(term)">
                        <span class="search-recent-icon" aria-hidden="true">
                          <app-icon name="history"></app-icon>
                        </span>
                        <span class="search-recent-text">{{ term }}</span>
                      </button>
                      <button uiButton="icon-subtle" type="button" class="search-recent-remove"
                              aria-label="Rimuovi dalla cronologia"
                              (click)="removeRecent(term)">
                        <app-icon name="close"></app-icon>
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
  private readonly scrollLock = inject(BodyScrollLockService);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly query = signal('');
  readonly searchOpen = signal(false);
  protected readonly suggestions = signal<TmdbItem[]>([]);
  protected readonly recents = signal<string[]>(loadRecents());
  protected readonly loading = signal(false);
  protected readonly highlighted = signal(-1);

  private fetchSeq = 0;
  private abortController: AbortController | null = null;
  private previousFocus: HTMLElement | null = null;
  private wasOpen = false;
  private hasLockedScroll = false;

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

  protected readonly showLoading = computed(() =>
    this.loading() && this.query().trim().length >= 2 && this.suggestions().length === 0
  );

  protected readonly showEmpty = computed(() =>
    !this.loading() && this.query().trim().length >= 2 && this.suggestions().length === 0
  );

  protected readonly listCount = computed(() => {
    if (this.showSuggestions()) return this.suggestions().length;
    if (this.showRecents()) return this.recents().length;
    return 0;
  });

  constructor() {
    /* Single effect handles focus save (on open), input focus (when the
     * input mounts) and focus restore (on close). wasOpen captures the
     * open→close / close→open transitions so the save/restore only
     * fires once per transition even though the effect re-runs when
     * the viewChild signal updates. */
    effect(() => {
      const open = this.searchOpen();
      if (open && !this.wasOpen) {
        const active = document.activeElement;
        this.previousFocus = active instanceof HTMLElement ? active : null;
        /* Lock the body scroll only on mobile — the desktop panel is
         * a small floating widget, locking the page scroll would be
         * unexpected. The backdrop overlay is hidden on desktop so
         * the user can still interact with content underneath. */
        if (window.matchMedia('(max-width: 768px)').matches) {
          this.scrollLock.acquire();
          this.hasLockedScroll = true;
        }
      } else if (!open && this.wasOpen) {
        const target = this.previousFocus;
        this.previousFocus = null;
        if (target) queueMicrotask(() => target.focus());
        if (this.hasLockedScroll) {
          this.scrollLock.release();
          this.hasLockedScroll = false;
        }
      }
      this.wasOpen = open;

      if (open) {
        const input = this.searchInput()?.nativeElement;
        if (input) {
          queueMicrotask(() => {
            input.focus();
            input.select();
          });
        }
      }
    });

    /* Debounced typeahead. fetchSeq is bumped on every effect
     * transition; AbortController cancels any in-flight network
     * request so abandoned queries don't keep traveling. */
    effect((onCleanup) => {
      const q = this.query().trim();
      if (q.length < 2) {
        this.suggestions.set([]);
        this.loading.set(false);
        this.fetchSeq++;
        this.abortController?.abort();
        this.abortController = null;
        return;
      }
      const handle = setTimeout(() => {
        void this.fetchSuggestions(q);
      }, SUGGESTION_DEBOUNCE_MS);
      onCleanup(() => {
        clearTimeout(handle);
        this.fetchSeq++;
        this.abortController?.abort();
        this.abortController = null;
      });
    });

    /* Reset the keyboard highlight when the underlying list changes
     * so a stale index doesn't point at the wrong row. */
    effect(() => {
      this.suggestions();
      this.recents();
      this.highlighted.set(-1);
    });
  }

  @HostListener('window:storage', ['$event'])
  protected onStorageEvent(event: StorageEvent): void {
    if (event.key === RECENTS_KEY) {
      this.recents.set(loadRecents());
    }
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
    queueMicrotask(() => this.searchInput()?.nativeElement.focus());
  }

  protected handleEscape(): void {
    if (this.query().trim()) this.clearQuery();
    else this.closeSearch();
  }

  protected onArrowDown(event: Event): void {
    event.preventDefault();
    const n = this.listCount();
    if (n === 0) return;
    this.highlighted.update((i) => (i + 1) % n);
  }

  protected onArrowUp(event: Event): void {
    event.preventDefault();
    const n = this.listCount();
    if (n === 0) return;
    this.highlighted.update((i) => (i <= 0 ? n - 1 : i - 1));
  }

  protected onEnter(event: Event): void {
    const idx = this.highlighted();
    if (this.showSuggestions() && idx >= 0 && idx < this.suggestions().length) {
      event.preventDefault();
      this.openSuggestion(this.suggestions()[idx]);
      return;
    }
    if (this.showRecents() && idx >= 0 && idx < this.recents().length) {
      event.preventDefault();
      this.useRecent(this.recents()[idx]);
      return;
    }
    this.submitSearch();
  }

  protected submitSearch(): void {
    const q = this.query().trim();
    if (!q) return;
    this.pushRecent(q);
    /* Navigating away — drop the saved focus so the close transition
     * doesn't try to focus an element the new page may have moved. */
    this.previousFocus = null;
    this.searchOpen.set(false);
    this.query.set('');
    this.suggestions.set([]);
    void this.router.navigate(['/search'], { queryParams: { q } });
  }

  protected openSuggestion(item: TmdbItem): void {
    const type = item.media_type;
    if (type !== 'movie' && type !== 'tv') return;
    this.pushRecent(this.query().trim());
    this.previousFocus = null;
    this.searchOpen.set(false);
    this.query.set('');
    this.suggestions.set([]);
    void this.router.navigate(['/watch', type, item.id]);
  }

  protected useRecent(term: string): void {
    this.query.set(term);
    this.submitSearch();
  }

  protected removeRecent(term: string): void {
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
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const seq = ++this.fetchSeq;
    this.loading.set(true);
    try {
      const results = await this.tmdb.searchAll(q, controller.signal);
      if (seq !== this.fetchSeq) return;
      this.suggestions.set(results.slice(0, SUGGESTION_LIMIT));
    } finally {
      if (this.abortController === controller) this.abortController = null;
      if (seq === this.fetchSeq) this.loading.set(false);
    }
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
