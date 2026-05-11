import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type BannerVariant = 'info' | 'success' | 'warning' | 'danger';

@Component({
  selector: 'app-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClass()',
    'role': 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true'
  },
  template: `
    <div class="banner-inner">
      @if (title()) {
        <strong>{{ title() }}</strong>
      }
      <span>{{ message() }}</span>
    </div>
  `,
  styleUrl: './banner.component.css'
})
export class BannerComponent {
  readonly title = input('');
  readonly message = input.required<string>();
  readonly variant = input<BannerVariant>('info');
  readonly fixed = input(true);

  protected readonly hostClass = computed(() => {
    const classes = ['app-banner', `variant-${this.variant()}`];
    if (this.fixed()) {
      classes.push('is-fixed');
    }
    return classes.join(' ');
  });
}
