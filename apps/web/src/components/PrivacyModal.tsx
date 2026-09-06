import React from 'react';
import { useApp } from '../context/AppContext';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

interface PrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResetVault: () => void;
}

/**
 * Phase 45: this used to keep its own local `useState` for retention
 * and biometric-lock — a duplicate, disconnected copy of the real
 * settings already stored in AppContext's `preferences`, so toggling
 * them here silently reset every time the modal reopened. Now reads
 * and writes the same real preferences AccountModal uses. The fake
 * "Anonymous Crash Diagnostics" toggle was removed outright — Twin has
 * no telemetry system for it to control. The "Export Knowledge Graph"
 * button was removed too — it never did anything but show a fake
 * "Encrypted JSON Backup Prepared" message; real profile export lives
 * in Account → Memory & Data.
 */
export const PrivacyModal: React.FC<PrivacyModalProps> = ({
  isOpen,
  onClose,
  onResetVault,
}) => {
  const { preferences, updatePreferences } = useApp();

  useEscapeToClose(onClose, isOpen);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-md p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">shield_lock</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Privacy &amp; Security
              </h3>
              <p className="text-xs font-mono text-slate-500">Account access is scoped to you</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <div className="space-y-4 my-4">
          {/* Status summary */}
          <div className="liquid-glass rounded-2xl p-4 border border-emerald-500/20 flex items-start gap-3">
            <span className="material-symbols-outlined text-emerald-400 text-xl mt-0.5">
              lock
            </span>
            <div className="text-xs">
              <p className="font-semibold text-slate-900 dark:text-white">
                No Third-Party Tracking
              </p>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                Your memories, decisions, and graph connections are stored server-side, scoped to
                your account. Twin runs no analytics or telemetry and never shares your data.
              </p>
            </div>
          </div>

          {/* Retention Setting */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-slate-400 block">
              Memory Retention Period
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'forever', label: 'Keep Forever' },
                  { id: '1year', label: '1 Year' },
                  { id: '90days', label: '90 Days' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => updatePreferences({ retentionPeriod: item.id })}
                  className={`py-2 px-2.5 rounded-xl text-xs font-mono transition-all ${
                    preferences.retentionPeriod === item.id
                      ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 font-semibold'
                      : 'bg-white/5 text-slate-400'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Biometrics Toggle */}
          <div className="flex items-center justify-between py-2 border-t border-white/5">
            <div>
              <p className="text-xs font-medium text-slate-800 dark:text-white">
                Face ID / Biometric Lock
              </p>
              <p className="text-[11px] text-slate-500">Require unlock to view your memories</p>
            </div>
            <button
              onClick={() => updatePreferences({ biometricLock: !preferences.biometricLock })}
              className={`w-11 h-6 rounded-full transition-colors relative ${
                preferences.biometricLock ? 'bg-indigo-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                  preferences.biometricLock ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>

          {/* Reset Action */}
          <div className="space-y-2 pt-2 border-t border-white/10">
            <button
              onClick={() => {
                if (confirm('Clear your cached Twin Chat conversation on this device?')) {
                  onResetVault();
                  onClose();
                }
              }}
              className="w-full py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-xs font-mono text-rose-400 flex items-center justify-center gap-2 border border-rose-500/20"
            >
              <span className="material-symbols-outlined text-[16px]">restart_alt</span>
              <span>Clear Twin Chat History</span>
            </button>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
