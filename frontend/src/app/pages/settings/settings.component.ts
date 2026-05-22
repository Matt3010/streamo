import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { faBell, faCirclePlay, faFolder } from '@fortawesome/free-solid-svg-icons';
import { PageHeaderComponent } from '../../ui/page-header/page-header.component';
import { SettingsToggleComponent } from '../../ui/settings-toggle/settings-toggle.component';
import { SectionHeaderComponent } from '../../ui/section-header/section-header.component';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { AuthService } from '../../services/auth.service';
import { PushNotificationsService } from '../../services/push-notifications.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [PageHeaderComponent, SettingsToggleComponent, SectionHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="Impostazioni" (back)="back()" />

    <div class="settings-content">
      <section class="settings-section">
        <div class="section-header">
          <div class="section-heading">
            <app-section-header title="Riproduzione" [icon]="playbackIcon" />
            <p class="section-caption">Preferenze che influenzano il comportamento del player.</p>
          </div>
        </div>

        <ui-settings-toggle
          title="Autoplay episodio successivo"
          description="Avvia automaticamente il prossimo episodio quando quello corrente termina."
          [checked]="autoplayEnabled()"
          [disabled]="savingAutoplay()"
          (changed)="onAutoplayChange($event)" />
      </section>

      <section class="settings-section">
        <div class="section-header">
          <div class="section-heading">
            <app-section-header title="Organizzazione" [icon]="foldersIcon" />
            <p class="section-caption">Controlla come raggruppi i titoli nella tua lista personale.</p>
          </div>
          <span class="settings-pill" [class.active]="foldersEnabled()">
            {{ foldersEnabled() ? 'Folder attivi' : 'Folder disattivi' }}
          </span>
        </div>

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

      <section class="settings-section">
        <div class="section-header">
          <div class="section-heading">
            <app-section-header title="Notifiche" [icon]="bellIcon" />
            <p class="section-caption">Avvisi su nuove uscite e titoli da riprendere. L'inbox in-app funziona sempre; il push richiede il permesso del browser.</p>
          </div>
        </div>

        <ui-settings-toggle
          title="Notifiche push sul dispositivo"
          [description]="pushDescription()"
          [checked]="pushEnabled()"
          [disabled]="push.busy() || !pushAvailable()"
          (changed)="onPushChange($event)" />

        @if (pushPermissionDenied()) {
          <div class="settings-note">
            Il browser ha bloccato le notifiche. Puoi sbloccarle dalle impostazioni del sito nel browser, poi riprovare.
          </div>
        }
        @if (pushUnconfigured()) {
          <div class="settings-note">
            Push non configurato lato server. L'inbox in-app continua a ricevere le notifiche in tempo reale.
          </div>
        }

        <ui-settings-toggle
          title="Nuovi episodi"
          description="Quando una serie sulla tua lista pubblica un nuovo episodio."
          [checked]="notifEpisode()"
          [disabled]="savingPref()"
          (changed)="onNotifChange('notif_new_episode', $event)" />

        <ui-settings-toggle
          title="Nuove stagioni"
          description="Quando una serie sulla tua lista pubblica una nuova stagione."
          [checked]="notifSeason()"
          [disabled]="savingPref()"
          (changed)="onNotifChange('notif_new_season', $event)" />

        <ui-settings-toggle
          title="Riprendi a guardare"
          description="Promemoria su titoli iniziati e non finiti da almeno una settimana."
          [checked]="notifResume()"
          [disabled]="savingPref()"
          (changed)="onNotifChange('notif_resume_reminder', $event)" />
      </section>
    </div>
  `,
  styleUrl: './settings.component.css'
})
export class SettingsComponent {
  protected readonly auth = inject(AuthService);
  protected readonly push = inject(PushNotificationsService);
  private readonly navSource = inject(NavigationSourceService);
  private readonly toast = inject(ToastService);

  protected readonly savingAutoplay = signal(false);
  protected readonly savingFolders = signal(false);
  protected readonly savingPref = signal(false);
  protected readonly autoplayEnabled = computed(() => this.auth.currentUser()?.autoplay_next === 1);
  protected readonly foldersEnabled = computed(() => this.auth.currentUser()?.folders_enabled === 1);
  protected readonly notifEpisode = computed(() => this.auth.currentUser()?.notif_new_episode === 1);
  protected readonly notifSeason = computed(() => this.auth.currentUser()?.notif_new_season === 1);
  protected readonly notifResume = computed(() => this.auth.currentUser()?.notif_resume_reminder === 1);
  protected readonly pushEnabled = computed(() => this.push.enabled());
  protected readonly pushAvailable = computed(() => this.push.permission() !== 'unsupported');
  protected readonly pushPermissionDenied = computed(() => this.push.permission() === 'denied');
  protected readonly pushUnconfigured = computed(() => this.push.permission() === 'unconfigured');
  protected readonly pushDescription = computed(() => {
    const p = this.push.permission();
    if (p === 'unsupported') return 'Il tuo browser non supporta le notifiche push.';
    if (p === 'unconfigured') return 'Le credenziali Firebase non sono configurate su questo server.';
    if (p === 'denied') return 'Permesso negato dal browser — sbloccalo dalle impostazioni del sito.';
    return 'Riceverai gli avvisi anche quando Streamo non è aperto.';
  });
  protected readonly playbackIcon = faCirclePlay;
  protected readonly foldersIcon = faFolder;
  protected readonly bellIcon = faBell;

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

  protected async onPushChange(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const enabling = target.checked;
    if (enabling) {
      const result = await this.push.enable();
      if (!result.ok) {
        target.checked = false;
        this.toast.show(this.errorMessage(result.reason));
      } else {
        this.toast.show('Notifiche push attivate');
      }
    } else {
      await this.push.disable();
      this.toast.show('Notifiche push disattivate');
    }
  }

  protected async onNotifChange(
    field: 'notif_new_episode' | 'notif_new_season' | 'notif_resume_reminder',
    event: Event
  ): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const next: 0 | 1 = target.checked ? 1 : 0;
    this.savingPref.set(true);
    const ok = await this.auth.setNotifPref(field, next);
    this.savingPref.set(false);
    if (!ok) {
      target.checked = !target.checked;
      this.toast.show('Impossibile aggiornare le preferenze');
    }
  }

  private errorMessage(reason: string | undefined): string {
    switch (reason) {
      case 'unsupported': return 'Browser non supportato';
      case 'unconfigured': return 'Push non configurato sul server';
      case 'denied': return 'Permesso negato dal browser';
      case 'default': return 'Permesso non concesso';
      case 'register_failed': return 'Registrazione fallita — riprova';
      default: return 'Attivazione fallita';
    }
  }
}
