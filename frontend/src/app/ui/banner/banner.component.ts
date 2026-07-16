import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent, type IconName } from '../icon/icon.component';

export type BannerVariant = 'info' | 'success' | 'warning' | 'danger';

@Component({
  selector: 'app-banner',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClass()',
    'role': 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true'
  },
  template: `
    <div class="banner-inner">
      <span class="banner-icon" aria-hidden="true">
        <app-icon [name]="iconName()" />
      </span>
      <span class="banner-copy">
        @if (title()) {
          <strong>{{ title() }}</strong>
        }
        <span class="banner-message">{{ message() }}</span>
      </span>
    </div>
  `,
  styleUrl: './banner.component.css'
})
export class BannerComponent {
  readonly title = input('');
  readonly message = input.required<string>();
  readonly variant = input<BannerVariant>('info');
  readonly fixed = input(true);

  protected readonly iconName = computed<IconName>(() => {
    if (this.variant() === 'success') return 'success';
    if (this.variant() === 'info') return 'info';
    return 'warning';
  });

  protected readonly hostClass = computed(() => {
    const classes = ['app-banner', `variant-${this.variant()}`];
    if (this.fixed()) {
      classes.push('is-fixed');
    }
    return classes.join(' ');
  });
}
