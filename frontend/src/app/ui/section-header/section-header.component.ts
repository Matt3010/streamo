import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

@Component({
  selector: 'app-section-header',
  standalone: true,
  imports: [FaIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="section-title">
      <span class="icon"><fa-icon [icon]="icon()"></fa-icon></span>
      <span class="section-title-text">{{ title() }}</span>
      <span class="section-title-actions"><ng-content></ng-content></span>
    </h2>
  `,
  styleUrl: './section-header.component.css'
})
export class SectionHeaderComponent {
  readonly title = input.required<string>();
  readonly icon = input.required<IconDefinition>();
}
