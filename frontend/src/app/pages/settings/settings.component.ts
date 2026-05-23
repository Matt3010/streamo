import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faBell, faBrush, faCirclePlay, faFolder } from '@fortawesome/free-solid-svg-icons';
import { faDroplet, faFloppyDisk, faPen, faRotateLeft, faShuffle, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { PageHeaderComponent } from '../../ui/page-header/page-header.component';
import { SettingsToggleComponent } from '../../ui/settings-toggle/settings-toggle.component';
import { SectionHeaderComponent } from '../../ui/section-header/section-header.component';
import { UiColorPickerComponent } from '../../ui/color-picker/color-picker.component';
import { UiPopoverComponent } from '../../ui/popover/popover.component';
import { UiRangeComponent } from '../../ui/range/range.component';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { AuthService } from '../../services/auth.service';
import { PushNotificationsService } from '../../services/push-notifications.service';
import { ToastService } from '../../services/toast.service';
import { UiButtonDirective } from '../../ui/ui-button.directive';

const PATTERN_TILE_SIZE = 96;
const DEFAULT_BRUSH_SIZE = 6;
const DEFAULT_BRUSH_COLOR = '#ffffff';
type PatternTool = 'draw' | 'recolor';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    PageHeaderComponent,
    SettingsToggleComponent,
    SectionHeaderComponent,
    UiButtonDirective,
    FaIconComponent,
    UiColorPickerComponent,
    UiRangeComponent,
    UiPopoverComponent
  ],
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
          <div class="pattern-control pattern-tool-control">
            <span>Modalità</span>
            <div class="pattern-tool-row">
              <button
                uiButton="panel"
                uiButtonSize="dense"
                type="button"
                class="pattern-tool-btn"
                [attr.aria-pressed]="activeTool() === 'draw'"
                (click)="setTool('draw')">
                <fa-icon [icon]="drawToolIcon"></fa-icon>
                Disegna
              </button>

              <button
                uiButton="panel"
                uiButtonSize="dense"
                type="button"
                class="pattern-tool-btn"
                [attr.aria-pressed]="activeTool() === 'recolor'"
                (click)="setTool('recolor')">
                <fa-icon [icon]="recolorToolIcon"></fa-icon>
                Ricolora
              </button>
            </div>
          </div>
        </div>

        <div class="pattern-secondary-controls">
          <ui-color-picker label="Colore" size="compact" [(value)]="brushColor" />

          <ui-range
            label="Pennello"
            [(value)]="brushSize"
            [min]="1"
            [max]="18"
            [step]="1"
            suffix="px" />
        </div>

        <div class="pattern-workbench">
          <div class="pattern-card">
            <div class="pattern-card-header">
              <strong>Editor tile 96×96</strong>
              <span>{{ activeTool() === 'draw' ? 'Trascina per disegnare' : 'Trascina per ricolorare' }}</span>
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
            uiButton
            uiButtonSize="compact"
            class="pattern-action-btn"
            type="button"
            [disabled]="savingPattern()"
            [attr.aria-expanded]="randomPopoverOpen()"
            (click)="toggleRandomPopover($event)">
            <fa-icon [icon]="randomIcon"></fa-icon>
            Random
          </button>

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

        <ui-popover
          [(open)]="randomPopoverOpen"
          [anchor]="randomPopoverAnchor()"
          [width]="320"
          horizontalAlign="start"
          preferredPlacement="above"
          [preferredHeight]="250"
          icon="settings"
          title="Genera pattern"
          secondary="Regola il carattere del tile e genera una nuova variante"
          (closed)="closeRandomPopover()">
          <div class="pattern-random-popover">
            <div class="pattern-random-field">
              <ui-range
                label="Densità"
                description="Controlla quanti elementi vengono distribuiti nel tile."
                [(value)]="randomDensity"
                [min]="1"
                [max]="10"
                [step]="1" />
            </div>

            <div class="pattern-random-field">
              <ui-range
                label="Variazione"
                description="Aumenta il contrasto tra forme, ritmo e direzione dei segni."
                [(value)]="randomVariation"
                [min]="1"
                [max]="10"
                [step]="1" />
            </div>

            <div class="pattern-random-field">
              <ui-range
                label="Scala"
                description="Definisce la dimensione media delle tracce generate."
                [(value)]="randomScale"
                [min]="1"
                [max]="10"
                [step]="1" />
            </div>

            <div class="pattern-random-actions">
              <button
                uiButton="ghost"
                uiButtonSize="dense"
                type="button"
                (click)="closeRandomPopover()">
                Chiudi
              </button>

              <button
                uiButton="primary"
                uiButtonSize="dense"
                type="button"
                (click)="generateRandomPattern()">
                Genera
              </button>
            </div>
          </div>
        </ui-popover>
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
  protected readonly activeTool = signal<PatternTool>('draw');
  protected readonly patternDirty = signal(false);
  protected readonly randomPopoverOpen = signal(false);
  protected readonly randomPopoverAnchor = signal<HTMLElement | null>(null);
  protected readonly randomDensity = signal(6);
  protected readonly randomVariation = signal(5);
  protected readonly randomScale = signal(6);
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
  protected readonly randomIcon: IconDefinition = faShuffle;
  protected readonly drawToolIcon: IconDefinition = faPen;
  protected readonly recolorToolIcon: IconDefinition = faDroplet;
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

  protected setTool(tool: PatternTool): void {
    this.activeTool.set(tool);
  }

  protected toggleRandomPopover(event: MouseEvent): void {
    const anchor = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!anchor) return;
    if (this.randomPopoverOpen() && this.randomPopoverAnchor() === anchor) {
      this.closeRandomPopover();
      return;
    }
    this.randomPopoverAnchor.set(anchor);
    this.randomPopoverOpen.set(true);
  }

  protected closeRandomPopover(): void {
    this.randomPopoverOpen.set(false);
    this.randomPopoverAnchor.set(null);
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

  protected generateRandomPattern(): void {
    const ctx = this.patternCanvasRef?.nativeElement.getContext('2d');
    if (!ctx) return;

    this.clearCanvas();
    const families = [
      () => this.drawRandomDots(ctx),
      () => this.drawRandomLines(ctx),
      () => this.drawRandomArcs(ctx),
      () => this.drawRandomCrosses(ctx)
    ] as const;

    const picks = 1 + Math.round(this.randomDensity() / 3) + Math.floor(Math.random() * Math.max(1, Math.round(this.randomVariation() / 4)));
    for (let index = 0; index < picks; index += 1) {
      families[Math.floor(Math.random() * families.length)]();
    }

    this.snapshotPatternDraft();
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
    if (this.activeTool() === 'recolor') {
      ctx.globalCompositeOperation = 'source-atop';
    }
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

  private drawRandomDots(ctx: CanvasRenderingContext2D): void {
    const count = 4 + this.randomDensity() * 2 + Math.floor(Math.random() * (2 + this.randomVariation()));
    for (let index = 0; index < count; index += 1) {
      const x = Math.random() * PATTERN_TILE_SIZE;
      const y = Math.random() * PATTERN_TILE_SIZE;
      const radius = Math.max(1.5, this.scaledSize(0.2, 0.7));
      this.drawWrapped(ctx, (drawX, drawY) => {
        ctx.save();
        ctx.fillStyle = this.brushColor();
        ctx.globalAlpha = this.randomAlpha(0.42, 0.3);
        ctx.beginPath();
        ctx.arc(drawX, drawY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }, x, y, radius);
    }
  }

  private drawRandomLines(ctx: CanvasRenderingContext2D): void {
    const count = 2 + Math.round(this.randomDensity() / 2) + Math.floor(Math.random() * Math.max(1, Math.round(this.randomVariation() / 3)));
    for (let index = 0; index < count; index += 1) {
      const x = Math.random() * PATTERN_TILE_SIZE;
      const y = Math.random() * PATTERN_TILE_SIZE;
      const length = PATTERN_TILE_SIZE * this.scaledFactor(0.18, 0.42);
      const angle = Math.random() * Math.PI * 2;
      const endX = x + Math.cos(angle) * length;
      const endY = y + Math.sin(angle) * length;
      const radius = length;
      this.drawWrapped(ctx, (drawX, drawY, offsetX, offsetY) => {
        ctx.save();
        ctx.strokeStyle = this.brushColor();
        ctx.globalAlpha = this.randomAlpha(0.24, 0.28);
        ctx.lineWidth = Math.max(1.25, this.scaledSize(0.2, 0.65));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(drawX, drawY);
        ctx.lineTo(endX + offsetX, endY + offsetY);
        ctx.stroke();
        ctx.restore();
      }, x, y, radius);
    }
  }

  private drawRandomArcs(ctx: CanvasRenderingContext2D): void {
    const count = 2 + Math.round(this.randomDensity() / 3) + Math.floor(Math.random() * Math.max(1, Math.round(this.randomVariation() / 4)));
    for (let index = 0; index < count; index += 1) {
      const x = Math.random() * PATTERN_TILE_SIZE;
      const y = Math.random() * PATTERN_TILE_SIZE;
      const radius = PATTERN_TILE_SIZE * this.scaledFactor(0.08, 0.18);
      const start = Math.random() * Math.PI * 2;
      const span = Math.PI * (0.22 + Math.random() * (0.35 + this.randomVariation() * 0.08));
      this.drawWrapped(ctx, (drawX, drawY) => {
        ctx.save();
        ctx.strokeStyle = this.brushColor();
        ctx.globalAlpha = this.randomAlpha(0.34, 0.24);
        ctx.lineWidth = Math.max(1.5, this.scaledSize(0.24, 0.7));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(drawX, drawY, radius, start, start + span);
        ctx.stroke();
        ctx.restore();
      }, x, y, radius);
    }
  }

  private drawRandomCrosses(ctx: CanvasRenderingContext2D): void {
    const count = 2 + Math.round(this.randomDensity() / 3) + Math.floor(Math.random() * Math.max(1, Math.round(this.randomVariation() / 4)));
    for (let index = 0; index < count; index += 1) {
      const x = Math.random() * PATTERN_TILE_SIZE;
      const y = Math.random() * PATTERN_TILE_SIZE;
      const size = PATTERN_TILE_SIZE * this.scaledFactor(0.05, 0.11);
      this.drawWrapped(ctx, (drawX, drawY) => {
        ctx.save();
        ctx.strokeStyle = this.brushColor();
        ctx.globalAlpha = this.randomAlpha(0.28, 0.24);
        ctx.lineWidth = Math.max(1.25, this.scaledSize(0.18, 0.36));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(drawX - size, drawY - size);
        ctx.lineTo(drawX + size, drawY + size);
        ctx.moveTo(drawX + size, drawY - size);
        ctx.lineTo(drawX - size, drawY + size);
        ctx.stroke();
        ctx.restore();
      }, x, y, size);
    }
  }

  private drawWrapped(
    ctx: CanvasRenderingContext2D,
    draw: (x: number, y: number, offsetX: number, offsetY: number) => void,
    x: number,
    y: number,
    radius: number
  ): void {
    const offsets = [-PATTERN_TILE_SIZE, 0, PATTERN_TILE_SIZE];
    for (const offsetX of offsets) {
      for (const offsetY of offsets) {
        const drawX = x + offsetX;
        const drawY = y + offsetY;
        if (drawX < -radius || drawX > PATTERN_TILE_SIZE + radius) continue;
        if (drawY < -radius || drawY > PATTERN_TILE_SIZE + radius) continue;
        draw(drawX, drawY, offsetX, offsetY);
      }
    }
  }

  private scaledFactor(min: number, variance: number): number {
    const scaleWeight = this.randomScale() / 10;
    const variationWeight = this.randomVariation() / 10;
    return min + scaleWeight * variance + Math.random() * variance * Math.max(0.15, variationWeight * 0.55);
  }

  private scaledSize(minFactor: number, variance: number): number {
    return Math.max(1, this.brushSize() * this.scaledFactor(minFactor, variance));
  }

  private randomAlpha(base: number, spread: number): number {
    const densityWeight = this.randomDensity() / 10;
    const variationWeight = this.randomVariation() / 10;
    return Math.min(0.92, base + densityWeight * 0.08 + Math.random() * spread * Math.max(0.25, variationWeight));
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
