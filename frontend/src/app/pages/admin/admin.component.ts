import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { BackButtonComponent } from '../../ui/back-button/back-button.component';
import { UiTabsComponent, type UiTab } from '../../ui/tabs/tabs.component';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { AdminTokensTabComponent } from './components/admin-tokens-tab.component';
import { AdminSessionsTabComponent } from './components/admin-sessions-tab.component';
import { AdminPlaybackLogsTabComponent } from './components/admin-playback-logs-tab.component';
import { AdminTransportLogsTabComponent } from './components/admin-transport-logs-tab.component';
import { AdminQueueTabComponent } from './components/admin-queue-tab.component';

type AdminTab = 'queue' | 'tokens' | 'sessions' | 'playback' | 'transport';

const ADMIN_TAB_STORAGE_KEY = 'streamo.admin.active-tab';
const ADMIN_TABS: ReadonlyArray<UiTab<AdminTab>> = [
  { value: 'queue', label: 'Queue' },
  { value: 'tokens', label: 'Token' },
  { value: 'sessions', label: 'Sessioni' },
  { value: 'playback', label: 'Playback' },
  { value: 'transport', label: 'Transport' }
];

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    BackButtonComponent,
    UiTabsComponent,
    AdminQueueTabComponent,
    AdminTokensTabComponent,
    AdminSessionsTabComponent,
    AdminPlaybackLogsTabComponent,
    AdminTransportLogsTabComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-header-back">
        <ui-back-button (pressed)="back()" />
      </div>
      <div class="page-header-row">
        <h2>Pannello Admin</h2>
      </div>
    </div>

    <div class="admin-content">
      <div class="admin-tabs-shell">
        <ui-tabs [tabs]="tabs" [(value)]="activeTab" />
      </div>

      @switch (activeTab()) {
        @case ('queue') {
          <app-admin-queue-tab />
        }
        @case ('tokens') {
          <app-admin-tokens-tab />
        }
        @case ('sessions') {
          <app-admin-sessions-tab />
        }
        @case ('playback') {
          <app-admin-playback-logs-tab />
        }
        @case ('transport') {
          <app-admin-transport-logs-tab />
        }
      }
    </div>
  `,
  styleUrl: './admin.component.css'
})
export class AdminComponent {
  private readonly navSource = inject(NavigationSourceService);
  protected readonly tabs = ADMIN_TABS;
  protected readonly activeTab = signal<AdminTab>(loadAdminTab());

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(ADMIN_TAB_STORAGE_KEY, this.activeTab());
      } catch {}
    });
  }

  protected back(): void {
    this.navSource.goBack('/');
  }
}

function loadAdminTab(): AdminTab {
  try {
    const value = localStorage.getItem(ADMIN_TAB_STORAGE_KEY);
    if (value === 'queue' || value === 'tokens' || value === 'sessions' || value === 'playback' || value === 'transport') {
      return value;
    }
  } catch {}
  return 'queue';
}
