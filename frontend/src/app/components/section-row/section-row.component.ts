import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { CardRowComponent } from '../card-row/card-row.component';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { CardItem } from '../../models';

@Component({
  selector: 'app-section-row',
  standalone: true,
  imports: [CardRowComponent, FaIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="content-section">
      <h2 class="section-title">
        <span class="icon"><fa-icon [icon]="icon()"></fa-icon></span>
        {{ title() }}
      </h2>
      <app-card-row
        [items]="items()"
        [loading]="loading()"
        [showProgress]="showProgress()"
        [showRemove]="showRemove()"
        (cardClick)="cardClick.emit($event)"
        (removeClick)="removeClick.emit($event)" />
    </section>
  `,
  styleUrl: './section-row.component.css'
})
export class SectionRowComponent {
  readonly title = input.required<string>();
  readonly icon = input.required<IconDefinition>();
  readonly items = input.required<CardItem[]>();
  readonly loading = input(false);
  readonly showProgress = input(false);
  readonly showRemove = input(false);

  readonly cardClick = output<CardItem>();
  readonly removeClick = output<CardItem>();
}
