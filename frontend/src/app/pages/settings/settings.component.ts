import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faBell, faBrush, faCirclePlay, faFolder } from '@fortawesome/free-solid-svg-icons';
import { faFloppyDisk, faRotateLeft, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { PageHeaderComponent } from '../../ui/page-header/page-header.component';
import { SettingsToggleComponent } from '../../ui/settings-toggle/settings-toggle.component';
import { SectionHeaderComponent } from '../../ui/section-header/section-header.component';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { AuthService } from '../../services/auth.service';
import { PushNotificationsService } from '../../services/push-notifications.service';
import { ToastService } from '../../services/toast.service';
import { UiButtonDirective } from '../../ui/ui-button.directive';

const PATTERN_TILE_SIZE = 96;
const DEFAULT_BRUSH_SIZE = 6;
const DEFAULT_BRUSH_COLOR = '#ffffff';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [PageHeaderComponent, SettingsToggleComponent, SectionHeaderComponent, UiButtonDirective, FaIconComponent],
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
            <app-section-header title="Trama Sfondo" [icon]="backgroundIcon" />
          </div>
          <span class="settings-pill" [class.active]="hasSavedPattern()">
            {{ hasSavedPattern() ? 'Trama attiva' : 'Nessuna trama' }}
          </span>
        </div>

        <div class="pattern-controls">
          <label class="pattern-control">
            <span>Colore</span>
            <input type="color" [value]="brushColor()" (input)="onBrushColorInput($event)" />
          </label>

          <label class="pattern-control pattern-control-range">
            <span>Pennello</span>
            <input
              type="range"
              min="1"
              max="18"
              step="1"
              [value]="brushSize()"
              (input)="onBrushSizeInput($event)" />
            <strong>{{ brushSize() }}px</strong>
          </label>
        </div>

        <div class="pattern-workbench">
          <div class="pattern-card">
            <div class="pattern-card-header">
              <strong>Editor tile 96×96</strong>
              <span>Trascina per disegnare</span>
            </div>
            <div class="pattern-canvas-shell">
              <button
                uiButton="icon-overlay"
                type="button"
                class="pattern-reset-fab"
                [disabled]="savingPattern() || !patternDirty()"
                (click)="resetCanvasToSavedPattern()"
                aria-label="Ripristina trama salvata"
                title="Ripristina trama salvata">
                <fa-icon [icon]="resetIcon"></fa-icon>
              </button>
              <div class="pattern-canvas-frame">
                <canvas
                  #patternCanvas
                  class="pattern-canvas"
                  width="96"
                  height="96"
                  (pointerdown)="onCanvasPointerDown($event)"
                  (pointermove)="onCanvasPointerMove($event)"
                  (pointerup)="onCanvasPointerUp($event)"
                  (pointercancel)="onCanvasPointerUp($event)"
                  (pointerleave)="onCanvasPointerLeave($event)"></canvas>
              </div>
            </div>
            <div class="pattern-canvas-hint">Il bordo del tile coincide con questo quadrato.</div>
          </div>

          <div class="pattern-card">
            <div class="pattern-card-header">
              <strong>Anteprima ripetuta</strong>
              <span>{{ patternDirty() ? 'Bozza non salvata' : (hasSavedPattern() ? 'Applicata all’app' : 'Disegna per iniziare') }}</span>
            </div>
            <div class="pattern-preview-shell">
              <div class="pattern-preview-fill" [style.background-image]="previewPatternImage()"></div>
              @if (!previewPatternDataUrl()) {
                <div class="pattern-preview-empty">Nessun elemento disegnato</div>
              }
            </div>
          </div>
        </div>

        <div class="pattern-actions">
          <button
            uiButton="primary"
            uiButtonSize="compact"
            class="pattern-action-btn"
            type="button"
            [disabled]="savingPattern()"
            (click)="saveBackgroundPattern()">
            <fa-icon [icon]="saveIcon"></fa-icon>
            {{ savingPattern() ? 'Salvataggio…' : 'Salva trama' }}
          </button>

          <button
            uiButton="danger-outline"
            uiButtonSize="compact"
            class="pattern-action-btn"
            type="button"
            [disabled]="savingPattern() || !hasSavedPattern()"
            (click)="removeBackgroundPattern()">
            <fa-icon [icon]="removeIcon"></fa-icon>
            Rimuovi trama
          </button>
        </div>
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
export class SettingsComponent implements AfterViewInit {
  @ViewChild('patternCanvas')
  private patternCanvasRef?: ElementRef<HTMLCanvasElement>;

  protected readonly auth = inject(AuthService);
  protected readonly push = inject(PushNotificationsService);
  private readonly navSource = inject(NavigationSourceService);
  private readonly toast = inject(ToastService);

  protected readonly savingAutoplay = signal(false);
  protected readonly savingFolders = signal(false);
  protected readonly savingPref = signal(false);
  protected readonly savingPattern = signal(false);
  protected readonly brushColor = signal(DEFAULT_BRUSH_COLOR);
  protected readonly brushSize = signal(DEFAULT_BRUSH_SIZE);
  protected readonly patternDirty = signal(false);
  protected readonly autoplayEnabled = computed(() => this.auth.currentUser()?.autoplay_next === 1);
  protected readonly foldersEnabled = computed(() => this.auth.currentUser()?.folders_enabled === 1);
  protected readonly notifEpisode = computed(() => this.auth.currentUser()?.notif_new_episode === 1);
  protected readonly notifSeason = computed(() => this.auth.currentUser()?.notif_new_season === 1);
  protected readonly notifResume = computed(() => this.auth.currentUser()?.notif_resume_reminder === 1);
  protected readonly savedPatternDataUrl = computed(() => this.auth.currentUser()?.background_pattern_data_url ?? null);
  protected readonly hasSavedPattern = computed(() => !!this.savedPatternDataUrl());
  protected readonly pushEnabled = computed(() => this.push.enabled());
  protected readonly pushAvailable = computed(() => this.push.permission() !== 'unsupported');
  protected readonly pushPermissionDenied = computed(() => this.push.permission() === 'denied');
  protected readonly pushUnconfigured = computed(() => this.push.permission() === 'unconfigured');
  protected readonly previewPatternDataUrl = signal<string | null>(null);
  protected readonly previewPatternImage = computed(() => {
    const url = this.previewPatternDataUrl();
    return url ? `url("${url}")` : '';
  });
  protected readonly pushDescription = computed(() => {
    const p = this.push.permission();
    if (p === 'unsupported') return 'Il tuo browser non supporta le notifiche push.';
    if (p === 'unconfigured') return 'Le credenziali Firebase non sono configurate su questo server.';
    if (p === 'denied') return 'Permesso negato dal browser — sbloccalo dalle impostazioni del sito.';
    return 'Riceverai gli avvisi anche quando AIR non è aperto.';
  });
  protected readonly playbackIcon = faCirclePlay;
  protected readonly foldersIcon = faFolder;
  protected readonly backgroundIcon = faBrush;
  protected readonly bellIcon = faBell;
  protected readonly saveIcon: IconDefinition = faFloppyDisk;
  protected readonly resetIcon: IconDefinition = faRotateLeft;
  protected readonly removeIcon: IconDefinition = faTrashCan;
  private drawingPointerId: number | null = null;
  private lastDrawPoint: { x: number; y: number } | null = null;
  private readonly patternCanvasReady = signal(false);
  private paintRequestSeq = 0;

  constructor() {
    effect(() => {
      if (!this.patternCanvasReady() || this.patternDirty()) return;
      void this.paintCanvasFromDataUrl(this.savedPatternDataUrl());
    });
  }

  ngAfterViewInit(): void {
    this.patternCanvasReady.set(true);
  }

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

  protected onBrushColorInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    this.brushColor.set(target.value || DEFAULT_BRUSH_COLOR);
  }

  protected onBrushSizeInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const next = Number(target.value);
    if (Number.isFinite(next) && next >= 1) this.brushSize.set(next);
  }

  protected onCanvasPointerDown(event: PointerEvent): void {
    const canvas = this.patternCanvasRef?.nativeElement;
    if (!canvas) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    this.drawingPointerId = event.pointerId;
    const point = this.canvasPoint(event);
    this.lastDrawPoint = point;
    this.drawSegment(point, point);
  }

  protected onCanvasPointerMove(event: PointerEvent): void {
    if (this.drawingPointerId !== event.pointerId || !this.lastDrawPoint) return;
    const point = this.canvasPoint(event);
    this.drawSegment(this.lastDrawPoint, point);
    this.lastDrawPoint = point;
  }

  protected onCanvasPointerUp(event: PointerEvent): void {
    const canvas = this.patternCanvasRef?.nativeElement;
    if (canvas && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (this.drawingPointerId !== event.pointerId) return;
    this.drawingPointerId = null;
    this.lastDrawPoint = null;
    this.snapshotPatternDraft();
  }

  protected onCanvasPointerLeave(event: PointerEvent): void {
    if (this.drawingPointerId === event.pointerId) this.onCanvasPointerUp(event);
  }

  protected async saveBackgroundPattern(): Promise<void> {
    if (this.isCanvasBlank()) {
      this.toast.show('Disegna qualcosa oppure usa "Rimuovi trama"');
      return;
    }

    const canvas = this.patternCanvasRef?.nativeElement;
    if (!canvas) return;

    this.savingPattern.set(true);
    const ok = await this.auth.setBackgroundPattern(canvas.toDataURL('image/png'));
    this.savingPattern.set(false);
    if (!ok) {
      this.toast.show('Impossibile salvare la trama');
      return;
    }

    this.previewPatternDataUrl.set(canvas.toDataURL('image/png'));
    this.patternDirty.set(false);
    this.toast.show('Trama salvata');
  }

  protected async removeBackgroundPattern(): Promise<void> {
    this.savingPattern.set(true);
    const ok = await this.auth.setBackgroundPattern(null);
    this.savingPattern.set(false);
    if (!ok) {
      this.toast.show('Impossibile rimuovere la trama');
      return;
    }

    this.clearCanvas();
    this.previewPatternDataUrl.set(null);
    this.patternDirty.set(false);
    this.toast.show('Trama rimossa');
  }

  protected resetCanvasToSavedPattern(): void {
    void this.paintCanvasFromDataUrl(this.savedPatternDataUrl(), { force: true });
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

  private canvasPoint(event: PointerEvent): { x: number; y: number } {
    const canvas = this.patternCanvasRef?.nativeElement;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  private drawSegment(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const ctx = this.patternCanvasRef?.nativeElement.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = this.brushColor();
    ctx.lineWidth = this.brushSize();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
    this.snapshotPatternDraft();
  }

  private snapshotPatternDraft(): void {
    const canvas = this.patternCanvasRef?.nativeElement;
    if (!canvas) return;
    this.previewPatternDataUrl.set(this.isCanvasBlank() ? null : canvas.toDataURL('image/png'));
    this.patternDirty.set(true);
  }

  private clearCanvas(): void {
    const ctx = this.patternCanvasRef?.nativeElement.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, PATTERN_TILE_SIZE, PATTERN_TILE_SIZE);
  }

  private isCanvasBlank(): boolean {
    const ctx = this.patternCanvasRef?.nativeElement.getContext('2d');
    if (!ctx) return true;
    const alpha = ctx.getImageData(0, 0, PATTERN_TILE_SIZE, PATTERN_TILE_SIZE).data;
    for (let index = 3; index < alpha.length; index += 4) {
      if (alpha[index] !== 0) return false;
    }
    return true;
  }

  private async paintCanvasFromDataUrl(dataUrl: string | null, options?: { force?: boolean }): Promise<void> {
    const canvas = this.patternCanvasRef?.nativeElement;
    if (!canvas) return;
    const requestSeq = ++this.paintRequestSeq;
    this.clearCanvas();
    if (!dataUrl) {
      if (requestSeq !== this.paintRequestSeq) return;
      this.previewPatternDataUrl.set(null);
      this.patternDirty.set(false);
      return;
    }

    await new Promise<void>((resolve) => {
      const image = new Image();
      image.onload = () => {
        if (requestSeq !== this.paintRequestSeq) {
          resolve();
          return;
        }
        if (!options?.force && this.patternDirty()) {
          resolve();
          return;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(image, 0, 0, PATTERN_TILE_SIZE, PATTERN_TILE_SIZE);
        resolve();
      };
      image.onerror = () => resolve();
      image.src = dataUrl;
    });

    if (requestSeq !== this.paintRequestSeq) return;
    if (!options?.force && this.patternDirty()) return;
    this.previewPatternDataUrl.set(dataUrl);
    this.patternDirty.set(false);
  }
}
