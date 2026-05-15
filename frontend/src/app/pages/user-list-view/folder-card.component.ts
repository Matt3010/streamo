import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../../ui/icon/icon.component';
import { UiSurfaceDirective } from '../../ui/ui-surface.directive';
import { folderMeta, type FolderGroup } from './folder.model';

export interface FolderDragEvent {
  event: DragEvent;
  group: FolderGroup;
}

/* display: contents lets the host element disappear from the .content-grid
 * layout so the toggle button and the expanded panel render as direct
 * grid children — required for the panel's grid-column: 1 / -1 span. */
@Component({
  selector: 'app-folder-card',
  standalone: true,
  imports: [IconComponent, UiSurfaceDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './folder-card.component.css',
  template: `
    <button uiSurface="card" type="button"
            [class.expanded]="expanded()"
            [class.folder-drop-active]="dropActive()"
            [attr.aria-expanded]="expanded()"
            (click)="toggle.emit(group().id)"
            (dragover)="dragOver.emit({ event: $event, group: group() })"
            (dragleave)="dragLeave.emit(group().id)"
            (drop)="drop.emit({ event: $event, group: group() })">
      <span class="folder-card-icon">
        <app-icon name="folder"></app-icon>
      </span>
      <span class="folder-card-body">
        <span class="folder-card-title">{{ group().name }}</span>
        <span class="folder-card-meta">{{ meta() }}</span>
      </span>
      <span class="folder-card-chevron" [class.expanded]="expanded()">
        <app-icon name="chevron-down"></app-icon>
      </span>
    </button>
    @if (expanded()) {
      <div class="folder-card-panel">
        <div class="folder-card-panel-grid">
          <ng-content></ng-content>
        </div>
      </div>
    }
  `
})
export class FolderCardComponent {
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
