import { strings } from '../i18n/strings';

export function Spinner({ label }: { label?: string }) {
  return <div class="spinner">{label ?? strings.loading}</div>;
}