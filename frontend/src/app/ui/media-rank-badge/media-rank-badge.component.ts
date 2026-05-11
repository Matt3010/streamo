import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { getMediaRankBadge } from '../../utils/media-rank.util';

@Component({
  selector: 'app-media-rank-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.compact]': 'compact()',
    '[class.align-right]': 'align() === "right"'
  },
  template: `
    @if (badge(); as data) {
      <div class="rank-badge" [attr.aria-label]="data.ariaLabel">
        <span class="rank-badge-dot" aria-hidden="true"></span>
        <span class="rank-badge-label">{{ data.label }}</span>
        <span class="rank-badge-trend" aria-hidden="true">▲</span>
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
