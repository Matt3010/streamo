import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, numberAttribute } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { IconComponent } from '../../components/icon/icon.component';
import { PlayerService } from '../../services/player.service';
import type { MediaType } from '../../models';

@Component({
  selector: 'app-watch',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="watch-page">
      <div class="watch-header">
        <button class="close-btn" aria-label="Indietro" (click)="back()">
          <app-icon name="close"></app-icon>
        </button>
        <h2>{{ title() }}</h2>
      </div>

      <div class="player-container">
        @if (player.currentItemType() === 'tv' && player.seasons().length > 0) {
          <div class="episode-controls active">
            <select (change)="onSeasonChange($event)">
              @for (s of player.seasons(); track s) {
                <option [value]="s" [selected]="s === player.selectedSeason()">Stagione {{ s }}</option>
              }
            </select>
            <select (change)="onEpisodeChange($event)">
              @for (e of player.episodes(); track e) {
                <option [value]="e" [selected]="e === player.selectedEpisode()">Episodio {{ e }}</option>
              }
            </select>
          </div>
        }

        <div class="player-wrapper">
          @if (!player.iframeSrc()) {
            <div class="player-preview">
              @if (player.backdropUrl()) {
                <img class="preview-backdrop" [src]="player.backdropUrl()" alt="">
              }
            </div>
          } @else {
            <iframe [src]="iframeSrcSafe()" allowfullscreen
                    allow="autoplay; encrypted-media; fullscreen"></iframe>
          }
        </div>

        @if (!player.iframeSrc()) {
          <div class="player-actions">
            <button class="action-btn primary" (click)="play()">
              <app-icon name="play"></app-icon>
              <span>{{ playLabel() }}</span>
            </button>
            @if (showNextButton()) {
              <button class="action-btn" (click)="playNext()">
                <span>Vai al prossimo</span>
              </button>
            }
            <button class="action-btn icon-only" [class.active]="player.isInWatchlist()"
                    [attr.aria-label]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    [title]="player.isInWatchlist() ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    (click)="toggleWatchlist()">
              <app-icon name="bookmark"></app-icon>
            </button>
          </div>
        }

        <div class="player-info">
          @if (taglineStr()) {
            <p class="player-tagline">{{ taglineStr() }}</p>
          }
          @if (metaStr()) {
            <p class="player-meta">{{ metaStr() }}</p>
          }
          @if (genresStr()) {
            <p class="player-genres">{{ genresStr() }}</p>
          }
          <p>{{ overview() }}</p>
          @if (castStr()) {
            <p class="player-cast"><strong>Cast:</strong> {{ castStr() }}</p>
          }
          @if (tvSummaryStr()) {
            <p class="player-extra">{{ tvSummaryStr() }}</p>
          }
        </div>
      </div>
    </div>
  `,
  styleUrl: './watch.component.css'
})
export class WatchComponent {
  protected readonly player = inject(PlayerService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  // Bound from route params/query via withComponentInputBinding().
  readonly type = input.required<MediaType>();
  readonly id = input.required<string>();
  readonly s = input(0, { transform: numberAttribute });
  readonly e = input(0, { transform: numberAttribute });

  protected readonly title = computed(() => {
    const it = this.player.currentItem();
    return it?.title ?? it?.name ?? '';
  });

  protected readonly overview = computed(() => this.player.currentItem()?.overview ?? 'Descrizione non disponibile.');

  // Strings (not arrays) so signal equality dedupes spurious updates.
  protected readonly taglineStr = computed(() => this.player.currentItem()?.tagline ?? '');

  protected readonly metaStr = computed(() => {
    const it = this.player.currentItem();
    if (!it) return '';
    const parts: string[] = [];
    const date = it.release_date ?? it.first_air_date ?? '';
    const year = date.split('-')[0];
    if (year) parts.push(year);
    const rt = formatRuntime(it, this.player.currentItemType());
    if (rt) parts.push(rt);
    if (it.vote_average) {
      parts.push(`★ ${it.vote_average.toFixed(1)}`);
    }
    return parts.join(' · ');
  });

  protected readonly genresStr = computed(() => {
    const gs = this.player.currentItem()?.genres ?? [];
    return gs.map(g => g.name).join(', ');
  });

  protected readonly castStr = computed(() => {
    const c = this.player.currentItem()?.credits?.cast ?? [];
    return c.slice(0, 6).map(m => m.name).join(', ');
  });

  // 80% mirrors WATCHED_THRESHOLD on the backend — past that point we
  // assume the user is "done enough" with this episode that they'd plausibly
  // want to skip straight to the next one.
  protected readonly showNextButton = computed(() => {
    if (!this.player.nextEpisode()) return false;
    const p = this.player.resumeProgress();
    if (!p || p.duration <= 0) return false;
    return p.position / p.duration >= 0.8;
  });

  protected readonly playLabel = computed(() => {
    const p = this.player.resumeProgress();
    if (p && p.position > 10) return `Riprendi da ${formatTime(p.position)}`;
    return 'Guarda';
  });

  protected readonly tvSummaryStr = computed(() => {
    if (this.player.currentItemType() !== 'tv') return '';
    const it = this.player.currentItem();
    const seasons = it?.number_of_seasons ?? 0;
    const episodes = it?.number_of_episodes ?? 0;
    if (!seasons) return '';
    const ses = seasons === 1 ? 'stagione' : 'stagioni';
    const eps = episodes === 1 ? 'episodio' : 'episodi';
    return episodes ? `${seasons} ${ses} · ${episodes} ${eps}` : `${seasons} ${ses}`;
  });

  // Same-origin URL but Angular still sanitizes iframe src by default.
  // Mark as trusted resource since the URL comes entirely from our own service.
  protected readonly iframeSrcSafe = computed<SafeResourceUrl>(
    () => this.sanitizer.bypassSecurityTrustResourceUrl(this.player.iframeSrc())
  );

  constructor() {
    effect(() => {
      const id = this.id();
      const type = this.type();
      if (!id || (type !== 'movie' && type !== 'tv')) return;
      void this.player.open(id, type, this.s(), this.e());
    });

    this.destroyRef.onDestroy(() => this.player.cleanup());
  }

  protected back(): void {
    if (window.history.length > 1) this.location.back();
    else void this.router.navigate(['/']);
  }

  protected play(): void {
    this.player.startVideo();
  }

  protected playNext(): void {
    void this.player.playNextEpisode();
  }

  protected toggleWatchlist(): void {
    void this.player.toggleWatchlist();
  }

  protected onSeasonChange(ev: Event): void {
    const t = ev.target;
    if (t instanceof HTMLSelectElement) void this.player.changeSeason(parseInt(t.value, 10));
  }

  protected onEpisodeChange(ev: Event): void {
    const t = ev.target;
    if (t instanceof HTMLSelectElement) void this.player.changeEpisode(parseInt(t.value, 10));
  }
}

function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatRuntime(item: { runtime?: number; episode_run_time?: number[] }, type: MediaType | null): string {
  if (type === 'movie') {
    const r = item.runtime;
    if (!r) return '';
    const h = Math.floor(r / 60);
    const m = r % 60;
    if (h && m) return `${h}h ${m}min`;
    if (h) return `${h}h`;
    return `${m}min`;
  }
  if (type === 'tv') {
    const arr = item.episode_run_time ?? [];
    const first = arr[0];
    return first ? `${first} min/episodio` : '';
  }
  return '';
}
