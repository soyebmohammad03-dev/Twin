import React, { useCallback, useEffect, useState } from 'react';
import { notificationsApi } from '../services/notificationsApi';
import {
  getBrowserNotificationSupport,
  requestBrowserNotificationPermission,
  type BrowserNotificationSupport,
} from '../services/browserNotifications';
import { ToggleSwitch } from './ToggleSwitch';

const PERMISSION_LABEL: Record<BrowserNotificationSupport, string> = {
  unsupported: 'Unsupported',
  default: 'Permission required',
  granted: 'Enabled',
  denied: 'Blocked',
};

const PERMISSION_COLOR: Record<BrowserNotificationSupport, string> = {
  unsupported: 'text-slate-500 dark:text-white/50',
  default: 'text-amber-600 dark:text-amber-400',
  granted: 'text-emerald-600 dark:text-emerald-400',
  denied: 'text-rose-600 dark:text-rose-400',
};

/**
 * Phase 46 — the real Notification settings surface. Distinguishes,
 * as the phase requires: preference enabled (server-persisted, gates
 * generation) vs. browser permission (per-device, gates delivery) vs.
 * which categories actually have a real generation signal behind them
 * at all. Morning Briefing / Evening Thought Synthesis are shown as
 * honestly deferred — no toggle, because no real signal or scheduler
 * backs them yet (see notifications.service.ts's PATTERN_INSIGHT_TYPES
 * comment). Pattern Recurrence Alerts is the one real, working category.
 */
export const NotificationSettingsSection: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [masterEnabled, setMasterEnabled] = useState(true);
  const [patternAlertsEnabled, setPatternAlertsEnabled] = useState(true);
  const [savingKey, setSavingKey] = useState<'master' | 'pattern' | null>(null);
  const [permission, setPermission] = useState<BrowserNotificationSupport>('unsupported');

  useEffect(() => {
    setPermission(getBrowserNotificationSupport());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prefs = await notificationsApi.getPreferences();
      setMasterEnabled(prefs.masterEnabled);
      setPatternAlertsEnabled(prefs.patternAlertsEnabled);
    } catch {
      setError("Couldn't load your notification preferences right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleToggleMaster(checked: boolean) {
    setSavingKey('master');
    setMasterEnabled(checked); // optimistic — real preferences, real API, not a fake instant success
    try {
      const prefs = await notificationsApi.updatePreferences({ masterEnabled: checked });
      setMasterEnabled(prefs.masterEnabled);
      setPatternAlertsEnabled(prefs.patternAlertsEnabled);
    } catch {
      setMasterEnabled(!checked); // roll back on real failure
      setError('Could not save that change. Please try again.');
    } finally {
      setSavingKey(null);
    }
  }

  async function handleTogglePattern(checked: boolean) {
    setSavingKey('pattern');
    setPatternAlertsEnabled(checked);
    try {
      const prefs = await notificationsApi.updatePreferences({ patternAlertsEnabled: checked });
      setPatternAlertsEnabled(prefs.patternAlertsEnabled);
    } catch {
      setPatternAlertsEnabled(!checked);
      setError('Could not save that change. Please try again.');
    } finally {
      setSavingKey(null);
    }
  }

  async function handleRequestPermission() {
    const result = await requestBrowserNotificationPermission();
    setPermission(result);
  }

  if (loading) {
    return <p className="text-xs text-slate-500 dark:text-white/50">Loading your notification preferences…</p>;
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-xs font-mono text-rose-500">{error}</p>}

      {/* Master preference — server-persisted, gates every category below */}
      <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/25 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 pr-2">
          <h4 className="font-semibold text-sm text-indigo-950 dark:text-indigo-200 truncate">Notifications</h4>
          <p className="text-xs text-indigo-800/80 dark:text-indigo-300/80 mt-0.5 leading-relaxed">
            Turns on real notification generation for the categories below
          </p>
        </div>
        <ToggleSwitch
          checked={masterEnabled}
          onChange={handleToggleMaster}
          disabled={savingKey !== null}
          color="indigo"
          ariaLabel="Notifications"
        />
      </div>

      {/* Browser delivery — per-device, separate from the preference above */}
      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
        <div className="min-w-0 flex-1 pr-2">
          <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">Browser notifications</h4>
          <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
            {permission === 'unsupported' &&
              'This browser does not support notifications. You can still see them in the notification center.'}
            {permission === 'default' && 'Requires your permission — only shown while Twin is open in this browser tab.'}
            {permission === 'granted' && 'Enabled — only shown while Twin is open in this browser tab, not in the background.'}
            {permission === 'denied' && 'Blocked in this browser. Change it in your browser\'s site settings to re-enable.'}
          </p>
        </div>
        {permission === 'default' ? (
          <button
            type="button"
            onClick={handleRequestPermission}
            className="shrink-0 px-3 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all active:scale-95 cursor-pointer"
          >
            Enable
          </button>
        ) : (
          <span className={`shrink-0 text-xs font-mono font-medium ${PERMISSION_COLOR[permission]}`}>{PERMISSION_LABEL[permission]}</span>
        )}
      </div>

      {/* Categories */}
      <div className={`space-y-3 transition-opacity ${masterEnabled ? 'opacity-100' : 'opacity-50'}`}>
        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
          <div className="min-w-0 flex-1 pr-2">
            <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">Pattern Recurrence Alerts</h4>
            <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
              Notifies you only when Twin's insight engine detects a real recurring topic, priority tension, or
              relationship tension — never a guess
            </p>
          </div>
          <ToggleSwitch
            checked={patternAlertsEnabled}
            onChange={handleTogglePattern}
            disabled={!masterEnabled || savingKey !== null}
            color="emerald"
            ariaLabel="Pattern Recurrence Alerts"
          />
        </div>

        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3 opacity-60">
          <div className="min-w-0 flex-1 pr-2">
            <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">Morning Briefing</h4>
            <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
              Requires background scheduling, which this deployment does not run yet — deferred, not available
            </p>
          </div>
          <span className="shrink-0 text-[10px] font-mono uppercase tracking-wide text-slate-400 dark:text-white/40">Deferred</span>
        </div>

        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3 opacity-60">
          <div className="min-w-0 flex-1 pr-2">
            <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">Evening Thought Synthesis</h4>
            <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
              Requires background scheduling, which this deployment does not run yet — deferred, not available
            </p>
          </div>
          <span className="shrink-0 text-[10px] font-mono uppercase tracking-wide text-slate-400 dark:text-white/40">Deferred</span>
        </div>
      </div>
    </div>
  );
};
