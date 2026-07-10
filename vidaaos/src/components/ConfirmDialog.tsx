import { useEffect } from 'preact/hooks';
import { Focusable } from '../spatial/Focusable';
import { pushBackHandler } from '../router/BackHandler';
import { strings } from '../i18n/strings';

export interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  useEffect(
    () => pushBackHandler(() => {
      onCancel();
      return true;
    }),
    // ponytail: empty deps — install once, close on back. onCancel identity churn
    // is acceptable; the dialog unmounts on close so stale closure is not a risk.
    []
  );

  return (
    <div class="overlay-scrim">
      <div class="overlay-card">
        <div class="overlay-title">{title}</div>
        {message && <div class="overlay-message">{message}</div>}
        <Focusable
          focusable={false}
          focusKey="confirm-dialog"
          trackChildren
          saveLastFocusedChild
          isFocusBoundary
          focusBoundaryDirections={['up', 'down', 'left', 'right']}
          className="overlay-actions"
        >
          <Focusable
            fill
            ring
            forceFocus={!!destructive}
            onSelect={onCancel}
            className="btn-cancel"
          >
            <span>{cancelLabel ?? strings.cancel}</span>
          </Focusable>
          <Focusable
            fill
            ring
            forceFocus={!destructive}
            onSelect={onConfirm}
            className={`btn-confirm${destructive ? ' destructive' : ''}`}
          >
            <span>{confirmLabel}</span>
          </Focusable>
        </Focusable>
      </div>
    </div>
  );
}
