import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BackButtonComponent } from '../../ui/back-button/back-button.component';
import { SettingsToggleComponent } from '../../ui/settings-toggle/settings-toggle.component';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [BackButtonComponent, SettingsToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-header-back">
        <ui-back-button (pressed)="back()" />
      </div>
      <div class="page-header-row">
        <h2>Impostazioni</h2>
      </div>
    </div>

    <section class="settings-panel">
      <header class="settings-header">
        <p class="settings-eyebrow">Preferenze account</p>
        <p class="settings-copy">Gestisci il comportamento del player e l'organizzazione della tua lista.</p>
      </header>

      <ui-settings-toggle
        title="Autoplay episodio successivo"
        description="Avvia automaticamente il prossimo episodio quando quello corrente termina."
        [checked]="autoplayEnabled()"
        [disabled]="savingAutoplay()"
        (changed)="onAutoplayChange($event)" />

      <ui-settings-toggle
        title="Folder nella mia lista"
        description="Raggruppa film e serie per contesto comune. In lista mobile usa un accordion, in griglia mostra card placeholder espandibili."
        [checked]="foldersEnabled()"
        [disabled]="savingFolders()"
        (changed)="onFoldersChange($event)" />

      @if (foldersEnabled()) {
        <div class="settings-note">
          I folder si assegnano dalla pagina "La mia lista" tramite l'icona cartella sulle card o sulle righe.
        </div>
      }
    </section>
  `,
  styleUrl: './settings.component.css'
})
export class SettingsComponent {
  protected readonly auth = inject(AuthService);
  private readonly navSource = inject(NavigationSourceService);
  private readonly toast = inject(ToastService);

  protected readonly savingAutoplay = signal(false);
  protected readonly savingFolders = signal(false);
  protected readonly autoplayEnabled = computed(() => this.auth.currentUser()?.autoplay_next === 1);
  protected readonly foldersEnabled = computed(() => this.auth.currentUser()?.folders_enabled === 1);

  protected back(): void {
    this.navSource.goBack('/browse');
  }

  protected async onAutoplayChange(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const next: 0 | 1 = target.checked ? 1 : 0;
    this.savingAutoplay.set(true);
    const ok = await this.auth.setAutoplay(next);
    this.savingAutoplay.set(false);
    if (!ok) {
      target.checked = !target.checked;
      this.toast.show('Impossibile aggiornare autoplay');
      return;
    }
    this.toast.show(next ? 'Autoplay attivato' : 'Autoplay disattivato');
  }

  protected async onFoldersChange(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const next: 0 | 1 = target.checked ? 1 : 0;
    this.savingFolders.set(true);
    const ok = await this.auth.setFoldersEnabled(next);
    this.savingFolders.set(false);
    if (!ok) {
      target.checked = !target.checked;
      this.toast.show('Impossibile aggiornare i folder');
      return;
    }
    this.toast.show(next ? 'Folder attivati' : 'Folder disattivati');
  }
}
