import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { getMediaRankBadge } from '../../utils/media-rank.util';

@Component({
  selector: 'app-media-rank-badge',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.compact]': 'compact()',
    '[class.align-right]': 'align() === "right"'
  },
  template: `
    @if (badge(); as data) {
      <div class="rank-badge" [attr.aria-label]="data.ariaLabel">
        <span class="rank-badge-icon" aria-hidden="true">
          <app-icon name="fire"></app-icon>
        </span>
        @if (data.label) {
          <span class="rank-badge-label">{{ data.label }}</span>
        }
        <span class="rank-badge-value">{{ data.value }}</span>
      </div>
    }
  `,
  styleUrl: './media-rank-badge.component.css'
})
export class MediaRankBadgeComponent {
  readonly popularity = input<number | null | undefined>(null);
  readonly voteCount = input<number | null | undefined>(null);
  readonly compact = input(false);
  readonly align = input<'left' | 'right'>('left');

  protected readonly badge = computed(() => getMediaRankBadge(this.popularity() ?? undefined, this.voteCount() ?? undefined));
}
