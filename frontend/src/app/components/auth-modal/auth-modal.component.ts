import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { UiModalComponent } from '../../ui/modal/modal.component';
import { UiButtonDirective } from '../../ui/ui-button.directive';
import { UiInputDirective } from '../../ui/ui-input.directive';
import { AuthService } from '../../services/auth.service';
import { AuthModalService } from '../../services/auth-modal.service';
import { ToastService } from '../../services/toast.service';

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: 'Compila tutti i campi',
  invalid_credentials: 'Credenziali non valide',
  too_many_attempts: 'Troppi tentativi, riprova piu tardi',
  network_error: 'Errore di connessione'
};

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [UiModalComponent, UiButtonDirective, UiInputDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-modal [(open)]="modalState.visible"
              title="Accedi"
              size="sm"
              (closed)="resetForm()">
      <form class="auth-form" (submit)="submit($event)">
        <label>
          <span>Email</span>
          <input uiInput type="email" autocomplete="email" maxlength="254" required
                 [value]="email()" (input)="updateEmail($event)">
        </label>
        <label>
          <span>Password</span>
          <input uiInput type="password" autocomplete="current-password" minlength="6" required
                 [value]="password()" (input)="updatePassword($event)">
        </label>
        @if (errorMsg()) { <p class="auth-error">{{ errorMsg() }}</p> }
        <button uiButton="primary" type="submit" [disabled]="submitting()">Accedi</button>
      </form>
    </ui-modal>
  `,
  styleUrl: './auth-modal.component.css'
})
export class AuthModalComponent {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly modalState = inject(AuthModalService);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly errorCode = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly errorMsg = computed(() => {
    const code = this.errorCode();
    if (!code) return '';
    return ERROR_MESSAGES[code] ?? 'Errore sconosciuto';
  });

  protected resetForm(): void {
    this.errorCode.set(null);
    this.email.set('');
    this.password.set('');
  }

  protected updateEmail(ev: Event): void {
    const t = ev.target;
    if (t instanceof HTMLInputElement) this.email.set(t.value);
  }
  protected updatePassword(ev: Event): void {
    const t = ev.target;
    if (t instanceof HTMLInputElement) this.password.set(t.value);
  }

  protected async submit(ev: Event): Promise<void> {
    ev.preventDefault();
    this.errorCode.set(null);
    this.submitting.set(true);
    try {
      const res = await this.auth.login(this.email().trim(), this.password());
      if (res.user) {
        this.toast.show(`Benvenuto, ${res.user.email}!`);
        this.modalState.visible.set(false);
        this.resetForm();
      } else {
        this.errorCode.set(res.error ?? 'unknown');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
