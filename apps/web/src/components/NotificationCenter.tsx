import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationDto } from '@twin/contracts';
import { notificationsApi } from '../services/notificationsApi';
import { getBrowserNotificationSupport, showBrowserNotification } from '../services/browserNotifications';

interface NotificationCenterProps {
  onOpenInsight: (insightId: string) => void;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Phase 46's real notification center — every row is a persisted
 * `notifications` row from the real API, never a fabricated demo item.
 * On open, it also does this session's one best-effort delivery
 * attempt for any unread row that hasn't been shown as a real browser
 * notification yet (see browserNotifications.ts) — honest about the
 * limitation that this only works while this tab is open, never in
 * the background.
 */
export const NotificationCenter: React.FC<NotificationCenterProps> = ({ onOpenInsight }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await notificationsApi.getNotifications();
      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);

      if (getBrowserNotificationSupport() === 'granted') {
        for (const n of result.notifications) {
          if (!n.deliveredAt && !n.readAt) {
            showBrowserNotification(n.title, n.body);
            try {
              await notificationsApi.markDelivered(n.id);
            } catch {
              // best-effort only — a failed delivery-attempt record never blocks the UI
            }
          }
        }
      }
    } catch {
      setError("Couldn't load your notifications right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll the unread count quietly so the bell badge stays current without a background push mechanism — an honest, disclosed substitute (see NotificationSettingsSection's copy), not a claim of real-time delivery.
  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  async function handleMarkRead(notification: NotificationDto) {
    if (notification.readAt) return;
    setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await notificationsApi.markRead(notification.id);
    } catch {
      load(); // real failure — resync with the server rather than leave optimistic state wrong
    }
  }

  async function handleMarkAllRead() {
    const previous = notifications;
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await notificationsApi.markAllRead();
    } catch {
      setNotifications(previous);
      load();
    }
  }

  function handleSelect(notification: NotificationDto) {
    handleMarkRead(notification);
    if (notification.sourceInsightId) {
      onOpenInsight(notification.sourceInsightId);
      setIsOpen(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 hover:bg-slate-200 dark:hover:bg-white/20 transition-all active:scale-95 cursor-pointer"
        title="Notifications"
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <span className="material-symbols-outlined text-[18px]">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 top-11 z-[55] w-80 max-h-[70vh] overflow-y-auto liquid-glass-heavy rounded-2xl border border-slate-200/80 dark:border-white/15 shadow-2xl"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/80 dark:border-white/10 sticky top-0 bg-white/90 dark:bg-[#0d0e15]/90 backdrop-blur">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</h4>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-xs font-mono text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
                Mark all read
              </button>
            )}
          </div>

          {loading && notifications.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-white/50 px-4 py-6 text-center">Loading…</p>
          )}
          {error && <p className="text-xs font-mono text-rose-500 px-4 py-3">{error}</p>}
          {!loading && notifications.length === 0 && !error && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-500 dark:text-white/50">Nothing yet.</p>
              <p className="text-xs text-slate-400 dark:text-white/30 mt-1">
                Twin notifies you here when its insight engine finds a real recurring pattern.
              </p>
            </div>
          )}

          <ul className="divide-y divide-slate-200/60 dark:divide-white/10">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => handleSelect(n)}
                  className={`w-full text-left px-4 py-3 flex flex-col gap-0.5 hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors cursor-pointer ${
                    !n.readAt ? 'bg-indigo-50/50 dark:bg-indigo-500/5' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                      {n.category === 'pattern_recurrence' ? 'Pattern detected' : n.category}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-white/40 shrink-0">{formatRelativeTime(n.createdAt)}</span>
                  </div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{n.title}</p>
                  <p className="text-xs text-slate-500 dark:text-white/50 line-clamp-2">{n.body}</p>
                  {n.sourceInsightId && (
                    <span className="text-[10px] font-mono text-indigo-500 dark:text-indigo-400 mt-0.5">View evidence →</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
