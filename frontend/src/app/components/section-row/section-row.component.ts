import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CardRowComponent } from '../card-row/card-row.component';
import { SectionHeaderComponent } from '../../ui/section-header/section-header.component';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { CardItem } from '../../models';

@Component({
  selector: 'app-section-row',
  standalone: true,
  imports: [CardRowComponent, SectionHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="content-section" [attr.id]="sectionId() || null">
      <app-section-header [title]="title()" [icon]="icon()">
        <ng-content select="[headerActions]"></ng-content>
      </app-section-header>
      <app-card-row
        [items]="items()"
        [loading]="loading()"
        [showProgress]="showProgress()"
        [showRemove]="showRemove()"
        [removeTitle]="removeTitle()"
        [showStatusToggle]="showStatusToggle()"
        [showWatchlistToggle]="showWatchlistToggle()"
        (cardClick)="cardClick.emit($event)"
        (removeClick)="removeClick.emit($event)"
        (statusToggleClick)="statusToggleClick.emit($event)"
        (watchlistToggleClick)="watchlistToggleClick.emit($event)" />
    </section>
  `,
  styleUrl: './section-row.component.css'
})
export class SectionRowComponent {
  readonly sectionId = input('');
  readonly title = input.required<string>();
  readonly icon = input.required<IconDefinition>();
  readonly items = input.required<CardItem[]>();
  readonly loading = input(false);
  readonly showProgress = input(false);
  readonly showRemove = input(false);
  readonly removeTitle = input('Rimuovi');
  readonly showStatusToggle = input(false);
  readonly showWatchlistToggle = input(false);

  readonly cardClick = output<CardItem>();
  readonly removeClick = output<CardItem>();
  readonly statusToggleClick = output<CardItem>();
  readonly watchlistToggleClick = output<CardItem>();
}
