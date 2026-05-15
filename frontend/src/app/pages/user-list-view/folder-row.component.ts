import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../../ui/icon/icon.component';
import { UiSurfaceDirective } from '../../ui/ui-surface.directive';
import { folderMeta, type FolderGroup } from './folder.model';
import type { FolderDragEvent } from './folder-card.component';

/* display: contents keeps the toggle button and the expanded <ul> as
 * direct children of the outer .folder-block <li>, preserving the
 * existing list layout. */
@Component({
  selector: 'app-folder-row',
  standalone: true,
  imports: [IconComponent, UiSurfaceDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './folder-row.component.css',
  template: `
    <button uiSurface="row" type="button"
            [class.expanded]="expanded()"
            [class.folder-drop-active]="dropActive()"
            [attr.aria-expanded]="expanded()"
            (click)="toggle.emit(group().id)"
            (dragover)="dragOver.emit({ event: $event, group: group() })"
            (dragleave)="dragLeave.emit(group().id)"
            (drop)="drop.emit({ event: $event, group: group() })">
      <span class="folder-row-main">
        <span class="folder-pill">
          <app-icon name="folder"></app-icon>
        </span>
        <span class="folder-row-copy">
          <span class="folder-row-title">{{ group().name }}</span>
          <span class="folder-row-meta">{{ meta() }}</span>
        </span>
      </span>
      <span class="folder-row-arrow" [class.expanded]="expanded()">
        <app-icon name="chevron-down"></app-icon>
      </span>
    </button>

    @if (expanded()) {
      <ul class="folder-items">
        <ng-content></ng-content>
      </ul>
    }
  `
})
export class FolderRowComponent {
  readonly group = input.required<FolderGroup>();
  readonly expanded = input(false);
  readonly dropActive = input(false);

  readonly toggle = output<string>();
  readonly dragOver = output<FolderDragEvent>();
  readonly dragLeave = output<string>();
  readonly drop = output<FolderDragEvent>();

  protected meta(): string {
    return folderMeta(this.group());
  }
}
