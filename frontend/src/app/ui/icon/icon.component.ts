import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faFire, faFilm, faEye, faStar, faCalendar, faTv, faSatelliteDish,
  faCirclePlay, faBookmark, faPlay, faMagnifyingGlass, faXmark,
  faChevronLeft, faChevronRight, faClockRotateLeft, faList, faCheck,
  faTableCellsLarge, faTrashCan, faCopy, faRotateLeft, faFolder, faGear,
  faChevronDown
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

export type IconName =
  | 'fire' | 'film' | 'eye' | 'star' | 'calendar' | 'tv' | 'satellite'
  | 'play-circle' | 'bookmark' | 'play' | 'search' | 'close'
  | 'chevron-left' | 'chevron-right' | 'history' | 'list' | 'check'
  | 'grid' | 'trash' | 'copy' | 'rotate-left' | 'folder' | 'settings'
  | 'chevron-down';

const REGISTRY: Record<IconName, IconDefinition> = {
  fire: faFire,
  film: faFilm,
  eye: faEye,
  star: faStar,
  calendar: faCalendar,
  tv: faTv,
  satellite: faSatelliteDish,
  'play-circle': faCirclePlay,
  bookmark: faBookmark,
  play: faPlay,
  search: faMagnifyingGlass,
  close: faXmark,
  'chevron-left': faChevronLeft,
  'chevron-right': faChevronRight,
  history: faClockRotateLeft,
  list: faList,
  check: faCheck,
  grid: faTableCellsLarge,
  trash: faTrashCan,
  copy: faCopy,
  'rotate-left': faRotateLeft,
  folder: faFolder,
  settings: faGear,
  'chevron-down': faChevronDown
};

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [FaIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<fa-icon [icon]="def()"></fa-icon>`,
  styles: [`:host { display: inline-flex; line-height: 0; }`]
})
export class IconComponent {
  readonly name = input.required<IconName>();
  protected readonly def = computed<IconDefinition>(() => REGISTRY[this.name()]);
}
