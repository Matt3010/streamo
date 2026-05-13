import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { faCirclePlay, faBookmark } from '@fortawesome/free-solid-svg-icons';
import { SectionRowComponent } from '../../components/section-row/section-row.component';
import { ConfirmModalComponent } from '../../ui/confirm-modal/confirm-modal.component';
import { SectionHeaderComponent } from '../../ui/section-header/section-header.component';
import { TmdbService } from '../../services/tmdb.service';
import { ProgressService } from '../../services/progress.service';
import { WatchlistService } from '../../services/watchlist.service';
import { AuthService } from '../../services/auth.service';
import { PlayerService } from '../../services/player.service';
import { ToastService } from '../../services/toast.service';
import { applyWatchlistFlags, runCardMutation, setCardWatchlistFlag, toggleCardWatchlist } from '../../utils/card-watchlist.util';
import { enrichCardsWithTmdb, tmdbToCardItem } from '../../utils/card-item.util';
import { getStatusTransition, getStatusConfirmModal, getStatusToastMessage } from '../../utils/watchlist-status.util';
import { SECTIONS } from './sections.config';
import type { WatchlistStatus, CardItem, SectionConfig } from '../../models';

interface SectionState {
  config: SectionConfig;
  items: CardItem[];
  loading: boolean;
}

type HomeConfirmAction =
  | { type: 'hide-continue'; item: CardItem }
  | { type: 'mark-watchlist-done'; item: CardItem }
  | { type: 'remove-watchlist'; item: CardItem; source: 'continue' | 'watchlist' };

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [SectionRowComponent, SectionHeaderComponent, ConfirmModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (auth.isLoggedIn() && (continueItems().length > 0 || userLoading())) {
      <app-section-row
        title="Continua a guardare"
        [icon]="continueIcon"
        [items]="continueItems()"
        [loading]="userLoading()"
        [showProgress]="true"
        [showRemove]="true"
        removeTitle="Nascondi"
        [showWatchlistToggle]="true"
        (cardClick)="open($event)"
        (removeClick)="removeContinue($event)"
        (watchlistToggleClick)="toggleContinueWatchlist($event)" />
    } @else if (auth.isLoggedIn() && !userLoading()) {
      <section class="content-section">
        <app-section-header title="Continua a guardare" [icon]="continueIcon" />
        <div class="home-empty-state">
          <p class="home-empty-title">Niente da riprendere</p>
          <p class="home-empty-hint">I titoli che inizi a guardare compariranno qui.</p>
          <div class="home-empty-actions">
            <button class="primary-btn" (click)="goToBrowse()">Scopri film popolari</button>
          </div>
        </div>
      </section>
    }

    @if (auth.isLoggedIn() && (watchlistItems().length > 0 || userLoading())) {
      <app-section-row
        title="La mia lista"
        [icon]="watchlistIcon"
        [items]="watchlistItems()"
        [loading]="userLoading()"
        [showProgress]="true"
        [showRemove]="true"
        removeTitle="Rimuovi dalla lista"
        [showStatusToggle]="true"
        (cardClick)="open($event)"
        (statusToggleClick)="toggleWatchlistStatus($event)"
        (removeClick)="removeFromHomeWatchlist($event)" />
    } @else if (auth.isLoggedIn() && !userLoading()) {
      <section class="content-section">
        <app-section-header title="La mia lista" [icon]="watchlistIcon" />
        <div class="home-empty-state">
          <p class="home-empty-title">La tua lista è vuota</p>
          <p class="home-empty-hint">Aggiungi un film o una serie con il segnalibro per ritrovarli qui.</p>
          <div class="home-empty-actions">
            <button class="primary-btn" (click)="goToSearch()">Vai a cercare</button>
          </div>
        </div>
      </section>
    }

    @for (s of sectionStates(); track s.config.id) {
      <app-section-row
        [title]="s.config.title"
        [icon]="s.config.icon"
        [items]="s.items"
        [loading]="s.loading"
        (cardClick)="open($event)" />
    }

    <ui-confirm-modal
      [(open)]="confirmModalOpen"
      [title]="confirmModalTitle()"
      [message]="confirmModalMessage()"
      [warning]="confirmModalWarning()"
      [actionLabel]="confirmModalActionLabel()"
      (cancelled)="cancelHomeAction()"
      (confirmed)="confirmHomeAction()" />
  `,
  styleUrl: './home.component.css'
})
export class HomeComponent {
  private readonly tmdb = inject(TmdbService);
  private readonly progress = inject(ProgressService);
  private readonly watchlist = inject(WatchlistService);
  protected readonly auth = inject(AuthService);
  private readonly player = inject(PlayerService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly continueIcon = faCirclePlay;
  protected readonly watchlistIcon = faBookmark;

  protected readonly continueItems = signal<CardItem[]>([]);
  protected readonly watchlistItems = signal<CardItem[]>([]);
  protected readonly userLoading = signal(false);
  protected readonly sectionStates = signal<SectionState[]>([]);
  protected readonly confirmModalOpen = signal(false);
  private readonly pendingAction = signal<HomeConfirmAction | null>(null);
  protected readonly confirmModalTitle = signal('Conferma');
  protected readonly confirmModalMessage = signal('');
  protected readonly confirmModalWarning = signal('');
  protected readonly confirmModalActionLabel = signal('Conferma');

  private userSeq = 0;

  constructor() {
    void this.loadTmdbSections();

    effect(() => {
      this.auth.currentUser();
      this.player.progressTick();
      this.progress.tick();
      this.watchlist.tick();
      void this.loadUserSections();
    });
  }

  protected open(item: CardItem): void {
    const queryParams: Record<string, number> = {};
    if (item.season) queryParams['s'] = item.season;
    if (item.episode) queryParams['e'] = item.episode;
    void this.router.navigate(['/watch', item.media_type, item.tmdb_id], { queryParams });
  }

  protected goToSearch(): void {
    void this.router.navigate(['/search']);
  }

  protected goToBrowse(): void {
    void this.router.navigate(['/browse']);
  }

  protected async removeContinue(item: CardItem): Promise<void> {
    this.pendingAction.set({ type: 'hide-continue', item });
    this.confirmModalTitle.set('Nascondi Da Continua a Guardare');
    this.confirmModalMessage.set(`Vuoi nascondere ${item.title} da Continua a guardare?`);
    this.confirmModalWarning.set('Il titolo sparirà da questa sezione finché non lo riprenderai.');
    this.confirmModalActionLabel.set('Nascondi');
    this.confirmModalOpen.set(true);
  }

  protected async toggleContinueWatchlist(item: CardItem): Promise<void> {
    if (!this.auth.isLoggedIn()) return;
    if (item.inWatchlist) {
      this.pendingAction.set({ type: 'remove-watchlist', item, source: 'continue' });
      this.confirmModalTitle.set('Rimuovi Dalla Lista');
      this.confirmModalMessage.set(`Vuoi rimuovere ${item.title} dalla tua lista?`);
      this.confirmModalWarning.set('Potrai sempre riaggiungerlo più tardi.');
      this.confirmModalActionLabel.set('Rimuovi');
      this.confirmModalOpen.set(true);
      return;
    }
    await runCardMutation(this.continueItems, item, 'watchlist', async () => {
      const result = await toggleCardWatchlist(item, this.watchlist);
      this.continueItems.update(items => setCardWatchlistFlag(items, item, result.inWatchlist));
      this.toast.show(result.message);
    });
  }

  protected async toggleWatchlistStatus(item: CardItem): Promise<void> {
    const { next, requiresConfirmation } = getStatusTransition(item.status);

    if (requiresConfirmation) {
      const modal = getStatusConfirmModal(item.title);
      this.pendingAction.set({ type: 'mark-watchlist-done', item });
      this.confirmModalTitle.set(modal.title);
      this.confirmModalMessage.set(modal.message);
      this.confirmModalWarning.set(modal.warning);
      this.confirmModalActionLabel.set(modal.actionLabel);
      this.confirmModalOpen.set(true);
      return;
    }

    await runCardMutation(this.watchlistItems, item, 'status', async () => {
      await this.watchlist.setStatus(item.tmdb_id, item.media_type, next);
      this.watchlistItems.update(items => items.map(candidate => (
        candidate.tmdb_id === item.tmdb_id && candidate.media_type === item.media_type
          ? { ...candidate, status: next }
          : candidate
      )));
      this.toast.show(getStatusToastMessage(item.title, next));
    });
  }

  protected async removeFromHomeWatchlist(item: CardItem): Promise<void> {
    this.pendingAction.set({ type: 'remove-watchlist', item, source: 'watchlist' });
    this.confirmModalTitle.set('Rimuovi Dalla Lista');
    this.confirmModalMessage.set(`Vuoi rimuovere ${item.title} dalla tua lista?`);
    this.confirmModalWarning.set('Potrai sempre riaggiungerlo più tardi.');
    this.confirmModalActionLabel.set('Rimuovi');
    this.confirmModalOpen.set(true);
  }

  protected cancelHomeAction(): void {
    this.pendingAction.set(null);
  }

  protected async confirmHomeAction(): Promise<void> {
    const action = this.pendingAction();
    this.pendingAction.set(null);
    if (!action) return;

    if (action.type === 'hide-continue') {
      const item = action.item;
      await runCardMutation(this.continueItems, item, 'remove', async () => {
        await this.progress.hideTitle(item.tmdb_id, item.media_type);
        this.continueItems.update((items) =>
          items.filter((candidate) => !(candidate.tmdb_id === item.tmdb_id && candidate.media_type === item.media_type))
        );
        this.toast.show(`${item.title}: nascosto da continua a guardare`);
      });
      return;
    }

    if (action.type === 'mark-watchlist-done') {
      const item = action.item;
      await runCardMutation(this.watchlistItems, item, 'status', async () => {
        await this.watchlist.setStatus(item.tmdb_id, item.media_type, 'done');
        this.watchlistItems.update(items =>
          items.filter(candidate => !(candidate.tmdb_id === item.tmdb_id && candidate.media_type === item.media_type))
        );
        this.toast.show(`${item.title}: segnato come visto`);
      });
      return;
    }

    const { item, source } = action;
    const itemsSignal = source === 'continue' ? this.continueItems : this.watchlistItems;
    await runCardMutation(itemsSignal, item, 'watchlist', async () => {
      await this.watchlist.remove(item.tmdb_id, item.media_type);
      if (source === 'continue') {
        this.continueItems.update(items => setCardWatchlistFlag(items, item, false));
      } else {
        this.watchlistItems.update(items =>
          items.filter(candidate => !(candidate.tmdb_id === item.tmdb_id && candidate.media_type === item.media_type))
        );
      }
      this.toast.show(`${item.title}: rimosso dalla lista`);
    });
  }

  private async loadTmdbSections(): Promise<void> {
    this.sectionStates.set(SECTIONS.map(c => ({ config: c, items: [], loading: true })));

    const results = await Promise.all(SECTIONS.map(c => this.tmdb.list(c.endpoint)));
    this.sectionStates.set(SECTIONS.map((c, i) => ({
      config: c,
      items: (results[i] ?? []).slice(0, 20).map(it => tmdbToCardItem(it, c.mediaType, true)),
      loading: false
    })));
  }

  private async loadUserSections(): Promise<void> {
    const seq = ++this.userSeq;
    if (!this.auth.isLoggedIn()) {
      this.continueItems.set([]);
      this.watchlistItems.set([]);
      this.userLoading.set(false);
      return;
    }

    this.userLoading.set(true);
    const [progress, wl] = await Promise.all([this.progress.list(), this.watchlist.list()]);
    if (seq !== this.userSeq) return;

    const progressCardsRaw = await enrichCardsWithTmdb(progress.map(p => ({
      tmdb_id: p.tmdb_id,
      media_type: p.media_type,
      title: p.title ?? 'Senza titolo',
      poster: p.poster,
      season: p.season,
      episode: p.episode,
      position: p.position,
      duration: p.duration
    })), this.tmdb);
    if (seq !== this.userSeq) return;

    const progressCards = applyWatchlistFlags(progressCardsRaw, wl);

    const watchlistCards = await enrichCardsWithTmdb(wl.filter(w => (w.status ?? 'todo') !== 'done').map(w => ({
      tmdb_id: w.tmdb_id,
      media_type: w.media_type,
      title: w.title ?? 'Senza titolo',
      poster: w.poster,
      status: w.status ?? 'todo',
      season: w.resume_season,
      episode: w.resume_episode,
      position: w.position,
      duration: w.duration,
      watchStatus: w.watch_status_text
    })), this.tmdb);
    if (seq !== this.userSeq) return;

    this.userLoading.set(false);
    this.continueItems.set(progressCards);
    this.watchlistItems.set(watchlistCards);
  }
}
