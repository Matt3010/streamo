import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { CardComponent } from '../card/card.component';
import { IconComponent } from '../../ui/icon/icon.component';
import { UiButtonDirective } from '../../ui/ui-button.directive';
import type { CardItem } from '../../models';

@Component({
  selector: 'app-card-row',
  standalone: true,
  imports: [CardComponent, IconComponent, UiButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row-container">
      <button uiButton="icon-circle" aria-label="Scorri sinistra" (click)="scroll(-1)">
        <app-icon name="chevron-left"></app-icon>
      </button>
      <div class="scroll-row" #row>
        @if (loading() && items().length === 0) {
          @for (n of skeletons; track n) {
            <div class="card-skeleton" aria-hidden="true">
              <div class="card-skeleton-poster"></div>
              <div class="card-skeleton-overlay">
                <div class="card-skeleton-line card-skeleton-title"></div>
                <div class="card-skeleton-line card-skeleton-meta"></div>
                @if (showProgress()) {
                  <div class="card-skeleton-line card-skeleton-status"></div>
                }
              </div>
              @if (showProgress()) {
                <div class="card-skeleton-progress"></div>
              }
            </div>
          }
        } @else {
          @for (item of items(); track item.tmdb_id + '-' + item.media_type + '-' + (item.season ?? 0) + '-' + (item.episode ?? 0)) {
            <app-card
              [item]="item"
              [showProgress]="showProgress()"
              [showRemove]="showRemove()"
              [removeTitle]="removeTitle()"
              [showStatusToggle]="showStatusToggle()"
              [showWatchlistToggle]="showWatchlistToggle()"
              (cardClick)="cardClick.emit($event)"
              (removeClick)="removeClick.emit($event)"
              (statusToggleClick)="statusToggleClick.emit($event)"
              (watchlistToggleClick)="watchlistToggleClick.emit($event)" />
          }
          @if (loading()) {
            @for (n of refreshSkeletons; track 'refresh-' + n) {
              <div class="card-skeleton" aria-hidden="true">
                <div class="card-skeleton-poster"></div>
                <div class="card-skeleton-overlay">
                  <div class="card-skeleton-line card-skeleton-title"></div>
                  <div class="card-skeleton-line card-skeleton-meta"></div>
                  @if (showProgress()) {
                    <div class="card-skeleton-line card-skeleton-status"></div>
                  }
                </div>
                @if (showProgress()) {
                  <div class="card-skeleton-progress"></div>
                }
              </div>
            }
          }
        }
      </div>
      <button uiButton="icon-circle" aria-label="Scorri destra" (click)="scroll(1)">
        <app-icon name="chevron-right"></app-icon>
      </button>
    </div>
  `,
  styleUrl: './card-row.component.css'
})
export class CardRowComponent {
  readonly items = input.required<CardItem[]>();
  readonly showProgress = input(false);
  readonly showRemove = input(false);
  readonly removeTitle = input('Rimuovi');
  readonly showStatusToggle = input(false);
  readonly showWatchlistToggle = input(false);
  readonly loading = input(false);

  // Static — skeleton count never changes per row, just enough placeholders
  // to fill a typical viewport so it doesn't look broken mid-load.
  protected readonly skeletons = [0, 1, 2, 3, 4, 5, 6, 7];
  protected readonly refreshSkeletons = [0, 1];

  readonly cardClick = output<CardItem>();
  readonly removeClick = output<CardItem>();
  readonly statusToggleClick = output<CardItem>();
  readonly watchlistToggleClick = output<CardItem>();

  private readonly row = viewChild.required<ElementRef<HTMLDivElement>>('row');

  protected scroll(direction: 1 | -1): void {
    const el = this.row().nativeElement;
    const card = el.querySelector<HTMLElement>('.card');
    const cardWidth = card ? card.offsetWidth : 185;
    el.scrollBy({ left: direction * (cardWidth + 12) * 3, behavior: 'smooth' });
  }
}
