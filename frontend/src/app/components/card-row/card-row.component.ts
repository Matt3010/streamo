import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { CardComponent } from '../card/card.component';
import { IconComponent } from '../icon/icon.component';
import type { CardItem } from '../../models';

@Component({
  selector: 'app-card-row',
  standalone: true,
  imports: [CardComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row-container">
      <button class="scroll-arrow left" aria-label="Scorri sinistra" (click)="scroll(-1)">
        <app-icon name="chevron-left"></app-icon>
      </button>
      <div class="scroll-row" #row>
        @for (item of items(); track item.tmdb_id + '-' + item.media_type + '-' + (item.season ?? 0) + '-' + (item.episode ?? 0)) {
          <app-card
            [item]="item"
            [showProgress]="showProgress()"
            [showRemove]="showRemove()"
            (cardClick)="cardClick.emit($event)"
            (removeClick)="removeClick.emit($event)" />
        }
      </div>
      <button class="scroll-arrow right" aria-label="Scorri destra" (click)="scroll(1)">
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

  readonly cardClick = output<CardItem>();
  readonly removeClick = output<CardItem>();

  private readonly row = viewChild.required<ElementRef<HTMLDivElement>>('row');

  protected scroll(direction: 1 | -1): void {
    const el = this.row().nativeElement;
    const card = el.querySelector<HTMLElement>('.card');
    const cardWidth = card ? card.offsetWidth : 185;
    el.scrollBy({ left: direction * (cardWidth + 12) * 3, behavior: 'smooth' });
  }
}
