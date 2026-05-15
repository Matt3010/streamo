import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { CardItem } from '../../models';

/* display: contents lets the host element disappear from the layout so the
 * .item-row flex parent still sees .item-type and .item-info as direct
 * children — required for the existing flex/min-width rules to apply. */
@Component({
  selector: 'app-list-item-info',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './list-item-info.component.css',
  template: `
    <span class="item-type">{{ item().media_type === 'tv' ? 'TV' : 'Film' }}</span>
    <div class="item-info">
      <span class="item-title">{{ item().title }}</span>
      @if (showSub()) {
        <span class="item-sub">
          @if (item().season && item().episode) {
            <span class="item-meta">S{{ item().season }} E{{ item().episode }}</span>
          }
          @if (item().watchStatus) {
            <span class="item-watch-status">{{ item().watchStatus }}</span>
          }
          @if (item().nextReleaseText) {
            <span class="item-release-status">{{ item().nextReleaseText }}</span>
          }
        </span>
      }
    </div>
  `
})
export class ListItemInfoComponent {
  readonly item = input.required<CardItem>();

  protected showSub(): boolean {
    const it = this.item();
    return !!((it.season && it.episode) || it.watchStatus || it.nextReleaseText);
  }
}
