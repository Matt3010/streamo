import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../ui/page-header/page-header.component';
import { UiTabsComponent, type UiTab } from '../../ui/tabs/tabs.component';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { AdminTokensTabComponent } from './components/admin-tokens-tab.component';
import { AdminSessionsTabComponent } from './components/admin-sessions-tab.component';
import { AdminQueueTabComponent } from './components/admin-queue-tab.component';
import { AdminLogsTabComponent } from './components/admin-logs-tab.component';
import { AdminEgressTabComponent } from './components/admin-egress-tab.component';

type AdminTab = 'queue' | 'tokens' | 'sessions' | 'logs' | 'egress';

const ADMIN_TAB_STORAGE_KEY = 'streamo.admin.active-tab';
const ADMIN_TABS: ReadonlyArray<UiTab<AdminTab>> = [
  { value: 'queue', label: 'Queue' },
  { value: 'tokens', label: 'Token' },
  { value: 'sessions', label: 'Sessioni' },
  { value: 'logs', label: 'Log' },
  { value: 'egress', label: 'Egress' }
];

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    PageHeaderComponent,
    UiTabsComponent,
    AdminQueueTabComponent,
    AdminTokensTabComponent,
    AdminSessionsTabComponent,
    AdminLogsTabComponent,
    AdminEgressTabComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="Pannello Admin" (back)="back()" />

    <div class="admin-content">
      <div class="filter-bar">
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
        @case ('logs') {
          <app-admin-logs-tab />
        }
        @case ('egress') {
          <app-admin-egress-tab />
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
    if (value === 'queue' || value === 'tokens' || value === 'sessions' || value === 'logs' || value === 'egress') {
      return value;
    }
  } catch {}
  return 'queue';
}
