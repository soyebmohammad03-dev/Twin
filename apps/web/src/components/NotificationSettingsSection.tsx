import React, { useCallback, useEffect, useState } from 'react';
import { notificationsApi } from '../services/notificationsApi';
import {
  getBrowserNotificationSupport,
  requestBrowserNotificationPermission,
  type BrowserNotificationSupport,
} from '../services/browserNotifications';
import { isWebPushSupported, getExistingSubscription, subscribeToPush, unsubscribeFromPush } from '../services/webPush';
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

type BackgroundDeliveryState = 'unsupported' | 'unavailable' | 'needs_permission' | 'available' | 'active';

/**
 * Phase 46/47 — the real Notification settings surface. Distinguishes,
 * as the phase requires: preference enabled (server-persisted, gates
 * generation) vs. browser permission (per-device, gates foreground
 * delivery) vs. real background delivery (Web Push — a genuine
 * subscription, gated separately on browser support + a server-side
 * VAPID keypair actually being configured) vs. which categories have
 * a real generation signal at all. All three categories — Pattern
 * Recurrence Alerts, Morning Briefing, Evening Thought Synthesis —
 * are real as of Phase 47 (see apps/api's worker/), each backed by
 * the background worker's scheduler, never a client-side timer.
 */
export const NotificationSettingsSection: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [masterEnabled, setMasterEnabled] = useState(true);
  const [patternAlertsEnabled, setPatternAlertsEnabled] = useState(true);
  const [morningBriefingEnabled, setMorningBriefingEnabled] = useState(false);
  const [eveningSynthesisEnabled, setEveningSynthesisEnabled] = useState(false);
  const [timezone, setTimezone] = useState('UTC');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [permission, setPermission] = useState<BrowserNotificationSupport>('unsupported');
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [backgroundState, setBackgroundState] = useState<BackgroundDeliveryState>('unsupported');
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);

  const refreshBackgroundState = useCallback(async (currentPermission: BrowserNotificationSupport, key: string | null) => {
    if (!isWebPushSupported()) {
      setBackgroundState('unsupported');
      return;
    }
    if (!key) {
      setBackgroundState('unavailable');
      return;
    }
    if (currentPermission !== 'granted') {
      setBackgroundState('needs_permission');
      return;
    }
    const existing = await getExistingSubscription().catch(() => null);
    setBackgroundState(existing ? 'active' : 'available');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prefs, vapid] = await Promise.all([notificationsApi.getPreferences(), notificationsApi.getVapidPublicKey()]);
      setMasterEnabled(prefs.masterEnabled);
      setPatternAlertsEnabled(prefs.patternAlertsEnabled);
      setMorningBriefingEnabled(prefs.morningBriefingEnabled);
      setEveningSynthesisEnabled(prefs.eveningSynthesisEnabled);
      setTimezone(prefs.timezone);
      setVapidPublicKey(vapid.publicKey);

      // Establishes the user's real timezone explicitly from their own
      // browser — never guessed from server location. Only syncs when
      // it actually differs, so this never fights a value the worker
      // is actively scheduling against mid-cycle for no reason.
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected && detected !== prefs.timezone) {
        const updated = await notificationsApi.updatePreferences({ timezone: detected });
        setTimezone(updated.timezone);
      }

      const currentPermission = getBrowserNotificationSupport();
      setPermission(currentPermission);
      await refreshBackgroundState(currentPermission, vapid.publicKey);
    } catch {
      setError("Couldn't load your notification preferences right now.");
    } finally {
      setLoading(false);
    }
  }, [refreshBackgroundState]);

  useEffect(() => {
    load();
  }, [load]);

  async function updatePreference(key: 'masterEnabled' | 'patternAlertsEnabled' | 'morningBriefingEnabled' | 'eveningSynthesisEnabled', checked: boolean) {
    const setters = {
      masterEnabled: setMasterEnabled,
      patternAlertsEnabled: setPatternAlertsEnabled,
      morningBriefingEnabled: setMorningBriefingEnabled,
      eveningSynthesisEnabled: setEveningSynthesisEnabled,
    } as const;
    setSavingKey(key);
    setters[key](checked); // optimistic — real preference, real API, not a fake instant success
    try {
      const prefs = await notificationsApi.updatePreferences({ [key]: checked });
      setMasterEnabled(prefs.masterEnabled);
      setPatternAlertsEnabled(prefs.patternAlertsEnabled);
      setMorningBriefingEnabled(prefs.morningBriefingEnabled);
      setEveningSynthesisEnabled(prefs.eveningSynthesisEnabled);
    } catch {
      setters[key](!checked); // roll back on real failure
      setError('Could not save that change. Please try again.');
    } finally {
      setSavingKey(null);
    }
  }

  async function handleRequestPermission() {
    const result = await requestBrowserNotificationPermission();
    setPermission(result);
    await refreshBackgroundState(result, vapidPublicKey);
  }

  async function handleEnableBackgroundDelivery() {
    if (!vapidPublicKey) return;
    setBackgroundBusy(true);
    setBackgroundError(null);
    try {
      const subscription = await subscribeToPush(vapidPublicKey);
      await notificationsApi.registerPushSubscription(subscription.toJSON());
      setBackgroundState('active');
    } catch {
      setBackgroundError('Could not enable background delivery in this browser. Please try again.');
    } finally {
      setBackgroundBusy(false);
    }
  }

  async function handleDisableBackgroundDelivery() {
    setBackgroundBusy(true);
    setBackgroundError(null);
    try {
      const existing = await getExistingSubscription();
      if (existing) await notificationsApi.unregisterPushSubscription(existing.endpoint);
      await unsubscribeFromPush();
      setBackgroundState('available');
    } catch {
      setBackgroundError('Could not disable background delivery. Please try again.');
    } finally {
      setBackgroundBusy(false);
    }
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
          onChange={(checked) => updatePreference('masterEnabled', checked)}
          disabled={savingKey !== null}
          color="indigo"
          ariaLabel="Notifications"
        />
      </div>

      {/* Foreground delivery — per-device, requires the tab to be open */}
      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
        <div className="min-w-0 flex-1 pr-2">
          <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">Browser notifications</h4>
          <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
            {permission === 'unsupported' &&
              'This browser does not support notifications. You can still see them in the notification center.'}
            {permission === 'default' && 'Requires your permission — only shown while Twin is open in this browser tab.'}
            {permission === 'granted' && 'Enabled — only shown while Twin is open in this browser tab.'}
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

      {/* Background delivery — Phase 47's real Web Push, works while Twin is closed */}
      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
        <div className="min-w-0 flex-1 pr-2">
          <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">Background delivery</h4>
          <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
            {backgroundState === 'unsupported' && 'This browser does not support background push delivery.'}
            {backgroundState === 'unavailable' && 'Not configured on this deployment — requires a server-side VAPID keypair.'}
            {backgroundState === 'needs_permission' && 'Enable browser notifications above first.'}
            {backgroundState === 'available' && 'Get notified even when Twin is closed, via a real push subscription.'}
            {backgroundState === 'active' && 'Enabled — this device receives notifications even when Twin is closed.'}
          </p>
          {backgroundError && <p className="text-xs font-mono text-rose-500 mt-1">{backgroundError}</p>}
        </div>
        {backgroundState === 'available' && (
          <button
            type="button"
            onClick={handleEnableBackgroundDelivery}
            disabled={backgroundBusy}
            className="shrink-0 px-3 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all active:scale-95 cursor-pointer disabled:opacity-60"
          >
            Enable
          </button>
        )}
        {backgroundState === 'active' && (
          <button
            type="button"
            onClick={handleDisableBackgroundDelivery}
            disabled={backgroundBusy}
            className="shrink-0 px-3 py-1.5 rounded-full bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/15 text-slate-800 dark:text-white text-xs font-semibold transition-all active:scale-95 cursor-pointer disabled:opacity-60"
          >
            Disable
          </button>
        )}
        {(backgroundState === 'unsupported' || backgroundState === 'unavailable' || backgroundState === 'needs_permission') && (
          <span className="shrink-0 text-[10px] font-mono uppercase tracking-wide text-slate-400 dark:text-white/40">
            {backgroundState === 'needs_permission' ? 'Blocked' : 'Unavailable'}
          </span>
        )}
      </div>

      {/* Categories — all three real as of Phase 47, scheduled by the background worker in the user's own timezone */}
      <div className={`space-y-3 transition-opacity ${masterEnabled ? 'opacity-100' : 'opacity-50'}`}>
        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
          <div className="min-w-0 flex-1 pr-2">
            <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">Pattern Recurrence Alerts</h4>
            <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
              Fires only when Twin's insight engine detects a real recurring topic, priority tension, or relationship
              tension — never a guess
            </p>
          </div>
          <ToggleSwitch
            checked={patternAlertsEnabled}
            onChange={(checked) => updatePreference('patternAlertsEnabled', checked)}
            disabled={!masterEnabled || savingKey !== null}
            color="emerald"
            ariaLabel="Pattern Recurrence Alerts"
          />
        </div>

        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
          <div className="min-w-0 flex-1 pr-2">
            <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">Morning Briefing</h4>
            <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
              A real summary of your current priorities, active projects, and open insights — sent 7-9am your time
              ({timezone}), only when there's something real to say
            </p>
          </div>
          <ToggleSwitch
            checked={morningBriefingEnabled}
            onChange={(checked) => updatePreference('morningBriefingEnabled', checked)}
            disabled={!masterEnabled || savingKey !== null}
            color="indigo"
            ariaLabel="Morning Briefing"
          />
        </div>

        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
          <div className="min-w-0 flex-1 pr-2">
            <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">Evening Thought Synthesis</h4>
            <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
              A real summary of today's Personal Model changes and new insights — sent 7-9pm your time ({timezone}),
              only when something genuinely changed today
            </p>
          </div>
          <ToggleSwitch
            checked={eveningSynthesisEnabled}
            onChange={(checked) => updatePreference('eveningSynthesisEnabled', checked)}
            disabled={!masterEnabled || savingKey !== null}
            color="purple"
            ariaLabel="Evening Thought Synthesis"
          />
        </div>
      </div>
    </div>
  );
};
