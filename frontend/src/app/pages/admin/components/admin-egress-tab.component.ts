import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { SectionHeaderComponent } from '../../../ui/section-header/section-header.component';
import { UiButtonDirective } from '../../../ui/ui-button.directive';
import { AdminService } from '../../../services/admin.service';

@Component({
  selector: 'app-admin-egress-tab',
  standalone: true,
  imports: [SectionHeaderComponent, UiButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="admin-section">
      <div class="section-header">
        <app-section-header title="Egress / WARP" [icon]="egressIcon" />
        <div class="section-actions">
          <button uiButton="primary" uiButtonSize="compact" type="button"
                  [disabled]="admin.egressCheckLoading()" (click)="refresh()">
            Verifica
          </button>
        </div>
      </div>

      <p class="section-caption">
        Sonda l'IP visto dal mondo dal backend. Se passa da Cloudflare WARP,
        vixcloud/TMDB vedono un IP CF, non quello residenziale.
      </p>

      @if (admin.egressCheckLoading() && !check()) {
        <p class="loading">Verifica in corso...</p>
      } @else if (!check()) {
        <p class="empty">Nessun controllo ancora eseguito</p>
      } @else {
        <div class="egress-flags">
          <span class="live-pill" [class.connected]="check()!.through_cloudflare">
            <span class="live-pill-dot" aria-hidden="true"></span>
            <span>{{ check()!.through_cloudflare ? 'Traffico in uscita via Cloudflare WARP' : 'NON sta passando da WARP' }}</span>
          </span>
          <span class="live-pill" [class.connected]="check()!.warp">
            <span class="live-pill-dot" aria-hidden="true"></span>
            <span>warp={{ check()!.warp ? 'on' : 'off' }}</span>
          </span>
        </div>

        <div class="egress-stats-grid">
          <div class="egress-stat-card">
            <span class="egress-stat-label">IP pubblico</span>
            <strong class="egress-stat-value">{{ check()!.ip ?? '—' }}</strong>
          </div>
          <div class="egress-stat-card">
            <span class="egress-stat-label">ASN / Org</span>
            <strong class="egress-stat-value">{{ check()!.asn_org ?? '—' }}</strong>
          </div>
          <div class="egress-stat-card">
            <span class="egress-stat-label">Colo CF</span>
            <strong class="egress-stat-value">{{ check()!.colo ?? '—' }}</strong>
          </div>
          <div class="egress-stat-card">
            <span class="egress-stat-label">Geo</span>
            <strong class="egress-stat-value">{{ geo() }}</strong>
          </div>
          <div class="egress-stat-card">
            <span class="egress-stat-label">Ultimo check</span>
            <strong class="egress-stat-value">{{ formatTimestamp(check()!.checked_at) }}</strong>
          </div>
        </div>

        @if (check()!.errors.length > 0) {
          <ul class="item-list">
            @for (err of check()!.errors; track err) {
              <li class="item-row">
                <span class="item-sub">{{ err }}</span>
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
  styleUrl: './admin-egress-tab.component.css'
})
export class AdminEgressTabComponent implements OnInit {
  protected readonly admin = inject(AdminService);
  protected readonly egressIcon = faShieldHalved;
  protected readonly check = computed(() => this.admin.egressCheck());
  protected readonly geo = computed(() => {
    const c = this.check();
    if (!c) return '—';
    return [c.city, c.country].filter(Boolean).join(', ') || '—';
  });

  ngOnInit(): void {
    void this.admin.fetchEgressCheck();
  }

  protected refresh(): void {
    void this.admin.fetchEgressCheck();
  }

  protected formatTimestamp(ts: number): string {
    return new Date(ts * 1000).toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
}
