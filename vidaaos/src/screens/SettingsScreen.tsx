// Settings screen — mirror of TvSettingsScreen (Downloads section hidden).
// Sections: Riproduzione (streaming quality picker), Rete e privacy (WARP toggle
// → sends warp:true to /vix/resolve via the proxy), Manutenzione (recalc library,
// spazio e cache), Backup (export/import JSON), Informazioni (version + TMDB
// attribution). Pickers use OptionOverlay; destructive actions use ConfirmDialog.
import { useEffect, useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import type { VNode } from 'preact';
import { Focusable } from '../spatial/Focusable';
import { OptionOverlay } from '../components/OptionOverlay';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useNav } from '../router/Router';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation-core';
import { settings } from '../data/settings';
import { repo } from '../data/repositories';
import { exportBackup, importBackup, type BackupPayload } from '../data/backup';
import { APP_VERSION } from '../util/version';
import { enableVirtualKeyboard } from '../util/device';
import { strings } from '../i18n/strings';
import { pushBackHandler } from '../router/BackHandler';

const PROXY_ORIGIN = (import.meta.env?.VITE_PROXY_ORIGIN as string | undefined) || '';

function SectionHeader({ title }: { title: string }) {
  return <div class="settings-section-header">{title}</div>;
}

function ValueRow({
  focusKey,
  label,
  value,
  onSelect,
  forceFocus
}: {
  focusKey: string;
  label: string;
  value?: string;
  onSelect: () => void;
  forceFocus?: boolean;
}) {
  return (
    <Focusable
      focusKey={focusKey}
      ring
      fill
      forceFocus={forceFocus}
      className="settings-row"
      onSelect={onSelect}
    >
      <span class="row-label">{label}</span>
      {value != null ? <span class="row-value">{value}</span> : null}
    </Focusable>
  );
}

function ToggleRow({
  focusKey,
  label,
  subtitle,
  checked,
  onToggle
}: {
  focusKey: string;
  label: string;
  subtitle?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <Focusable
      focusKey={focusKey}
      ring
      fill
      className="settings-row"
      onSelect={onToggle}
    >
      <div class="toggle-text">
        <span class="row-label">{label}</span>
        {subtitle ? <span class="row-subtitle">{subtitle}</span> : null}
      </div>
      <span class={`toggle-switch${checked ? ' on' : ''}`}>
        <span class="toggle-knob" />
      </span>
    </Focusable>
  );
}

function ApiKeyRow({ onSelect }: { onSelect: () => void }) {
  return (
    <Focusable
      focusKey="set-tmdb-api-key"
      ring
      fill
      className="settings-row"
      onSelect={onSelect}
    >
      <div class="toggle-text">
        <span class="row-label">{strings.tmdbApiKey}</span>
        <span class="row-subtitle">{strings.tmdbApiKeyHint}</span>
      </div>
      <span class="row-value">{settings.apiKey.value ? '••••••••' : strings.edit}</span>
    </Focusable>
  );
}

function ApiKeyDialog({ onClose }: { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const value = useSignal(settings.apiKey.value);
  const focusInput = () => {
    inputRef.current?.focus();
    enableVirtualKeyboard();
  };

  useEffect(() => {
    const id = requestAnimationFrame(focusInput);
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => pushBackHandler(() => {
    onClose();
    return true;
  }), []);

  return (
    <div class="overlay-scrim">
      <Focusable
        focusable={false}
        focusKey="api-key-dialog"
        trackChildren
        saveLastFocusedChild
        isFocusBoundary
        focusBoundaryDirections={['up', 'down', 'left', 'right']}
        className="overlay-card settings-api-key-dialog"
      >
        <div class="overlay-title">{strings.tmdbApiKey}</div>
        <Focusable
          focusKey="api-key-input"
          ring
          forceFocus
          onFocus={focusInput}
          onSelect={focusInput}
          className="settings-api-key-input-wrap"
        >
          <input
            ref={inputRef}
            class="settings-api-key-input"
            type="text"
            value={value.value}
            placeholder="Inserisci la chiave TMDB"
            autocomplete="off"
            spellcheck={false}
            onInput={(e) => (value.value = e.currentTarget.value)}
          />
        </Focusable>
        <div class="overlay-actions">
          <Focusable fill ring onSelect={onClose} className="btn-cancel"><span>{strings.cancel}</span></Focusable>
          <Focusable fill ring onSelect={() => {
            settings.apiKey.value = value.value.trim();
            onClose();
          }} className="btn-confirm"><span>{strings.confirm}</span></Focusable>
        </div>
      </Focusable>
    </div>
  );
}

export function SettingsScreen(): VNode {
  const { navigate } = useNav();
  const overlay = useSignal<null | 'apiKey' | 'quality' | 'recalc' | 'importConfirm' | 'warpRegister'>(null);
  const toast = useSignal<string | null>(null);
  const warpStatus = useSignal<string | null>(null);
  const warpChecking = useSignal(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingPayloadRef = useRef<BackupPayload | null>(null);

  // Anchor focus on the first row after mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setFocus('set-quality'));
    return () => cancelAnimationFrame(id);
  }, []);

  const showToast = (msg: string) => {
    toast.value = msg;
    setTimeout(() => {
      toast.value = null;
    }, 2500);
  };

  const qualityLabel = (q: string) => q === 'auto' ? strings.auto : q === 'max' ? 'Massima' : `${q}p`;

  const verifyWarp = async () => {
    if (!settings.warpEnabled.value) {
      warpStatus.value = strings.warpEnableFirst;
      return;
    }
    warpChecking.value = true;
    try {
      const res = await fetch(`${PROXY_ORIGIN}/warp/status`);
      const data = await res.json() as { message?: string };
      warpStatus.value = data.message ?? strings.error;
    } catch {
      warpStatus.value = strings.error;
    } finally {
      warpChecking.value = false;
    }
  };

  const registerWarp = async () => {
    warpChecking.value = true;
    try {
      const res = await fetch(`${PROXY_ORIGIN}/warp/register`, { method: 'POST' });
      if (!res.ok) throw new Error();
      warpStatus.value = strings.warpRegistered;
    } catch {
      warpStatus.value = strings.error;
    } finally {
      warpChecking.value = false;
      overlay.value = null;
    }
  };

  const doExport = async () => {
    try {
      const payload = await exportBackup();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `streamo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(strings.backupExported);
    } catch {
      showToast(strings.error);
    }
  };

  const onFilePicked = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as BackupPayload;
      if (!payload || !Array.isArray(payload.watchlist) || !Array.isArray(payload.progress) || !Array.isArray(payload.history)) {
        throw new Error('invalid');
      }
      overlay.value = 'importConfirm';
      pendingPayloadRef.current = payload;
    } catch {
      showToast(strings.backupImportError);
    }
  };

  const confirmImport = async () => {
    if (!pendingPayloadRef.current) return;
    try {
      await importBackup(pendingPayloadRef.current);
      showToast(strings.backupImported);
    } catch {
      showToast(strings.backupImportError);
    } finally {
      pendingPayloadRef.current = null;
      overlay.value = null;
    }
  };

  const doRecalc = async () => {
    await repo.recalcLibrary();
    overlay.value = null;
    showToast(strings.recalcDone);
  };

  return (
    <div class="screen settings-screen">
      <div class="settings-scroll">
        <div class="settings-title">{strings.settings}</div>

        <SectionHeader title={strings.playback} />
        <ValueRow
          focusKey="set-quality"
          label={strings.qualityStreaming}
          value={qualityLabel(settings.streamingQualityWifi.value)}
          onSelect={() => (overlay.value = 'quality')}
          forceFocus
        />

        <SectionHeader title={strings.catalog} />
        <ApiKeyRow onSelect={() => (overlay.value = 'apiKey')} />

        <SectionHeader title={strings.networkPrivacy} />
        <ToggleRow
          focusKey="set-warp"
          label={strings.maskIp}
          subtitle={strings.warpSubtitle}
          checked={settings.warpEnabled.value}
          onToggle={() => (settings.warpEnabled.value = !settings.warpEnabled.value)}
        />
        <ValueRow
          focusKey="set-warp-register"
          label={strings.registerWarp}
          value={warpChecking.value ? '…' : strings.registerWarpHint}
          onSelect={() => (overlay.value = 'warpRegister')}
        />
        <ValueRow
          focusKey="set-warp-check"
          label={strings.verifyWarp}
          value={warpChecking.value ? '…' : strings.verifyWarpHint}
          onSelect={verifyWarp}
        />
        {warpStatus.value ? <div class="settings-status">{warpStatus.value}</div> : null}

        <SectionHeader title={strings.maintenance} />
        <ValueRow
          focusKey="set-recalc"
          label={strings.recalcLibraryRow}
          onSelect={() => (overlay.value = 'recalc')}
        />
        <ValueRow
          focusKey="set-cache"
          label={strings.spaceCacheRow}
          onSelect={() => navigate({ name: 'cacheManagement' })}
        />

        <SectionHeader title={strings.backupSection} />
        <ValueRow focusKey="set-export" label={strings.exportBackup} onSelect={doExport} />
        <ValueRow
          focusKey="set-import"
          label={strings.importBackup}
          onSelect={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef as any}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={onFilePicked}
        />

        <SectionHeader title={strings.about} />
        <ValueRow focusKey="set-version" label={strings.versionRow} value={APP_VERSION} onSelect={() => {}} />
        <div class="tmdb-attribution">{strings.tmdbAttribution}</div>
      </div>

      {toast.value ? <div class="toast">{toast.value}</div> : null}

      {overlay.value === 'quality' ? (
        <OptionOverlay
          title={strings.qualityStreaming}
          options={[
            { id: 'auto', label: strings.auto, selected: settings.streamingQualityWifi.value === 'auto' },
            { id: 'max', label: 'Massima', selected: settings.streamingQualityWifi.value === 'max' },
            { id: '1080', label: '1080p', selected: settings.streamingQualityWifi.value === '1080' },
            { id: '720', label: '720p', selected: settings.streamingQualityWifi.value === '720' },
            { id: '480', label: '480p', selected: settings.streamingQualityWifi.value === '480' }
          ]}
          onSelect={(id) => {
            settings.streamingQualityWifi.value = String(id);
            overlay.value = null;
          }}
          onClose={() => (overlay.value = null)}
        />
      ) : null}

      {overlay.value === 'apiKey' ? <ApiKeyDialog onClose={() => (overlay.value = null)} /> : null}

      {overlay.value === 'recalc' ? (
        <ConfirmDialog
          title={strings.recalcConfirmTitle}
          message={strings.recalcConfirmBody}
          confirmLabel={strings.confirm}
          destructive
          onConfirm={doRecalc}
          onCancel={() => (overlay.value = null)}
        />
      ) : null}

      {overlay.value === 'warpRegister' ? (
        <ConfirmDialog
          title={strings.registerWarpConfirmTitle}
          message={strings.registerWarpConfirmBody}
          confirmLabel={strings.confirm}
          onConfirm={registerWarp}
          onCancel={() => (overlay.value = null)}
        />
      ) : null}

      {overlay.value === 'importConfirm' ? (
        <ConfirmDialog
          title={strings.backupImportConfirmTitle}
          message={strings.backupImportConfirmBody}
          confirmLabel={strings.confirm}
          onConfirm={confirmImport}
          onCancel={() => {
            pendingPayloadRef.current = null;
            overlay.value = null;
          }}
        />
      ) : null}
    </div>
  );
}
