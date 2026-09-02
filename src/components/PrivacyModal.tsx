import React, { useState } from 'react';

interface PrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResetVault: () => void;
}

export const PrivacyModal: React.FC<PrivacyModalProps> = ({
  isOpen,
  onClose,
  onResetVault,
}) => {
  const [retention, setRetention] = useState<'forever' | '1year' | '90days'>('forever');
  const [telemetry, setTelemetry] = useState(false);
  const [biometricLock, setBiometricLock] = useState(true);
  const [exportNotice, setExportNotice] = useState(false);

  if (!isOpen) return null;

  const handleExport = () => {
    setExportNotice(true);
    setTimeout(() => {
      setExportNotice(false);
    }, 2500);
  };

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
              <p className="text-xs font-mono text-slate-500">Twin On-Device Vault</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
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
                Zero Cloud-Telemetry Guarantee
              </p>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                Your memories, voice memos, and graph clusters are stored in an encrypted local vector
                database. No data leaves this device.
              </p>
            </div>
          </div>

          {/* Retention Setting */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-slate-400 block">
              Memory Vault Retention
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setRetention('forever')}
                className={`py-2 px-2.5 rounded-xl text-xs font-mono transition-all ${
                  retention === 'forever'
                    ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 font-semibold'
                    : 'bg-white/5 text-slate-400'
                }`}
              >
                Keep Forever
              </button>
              <button
                type="button"
                onClick={() => setRetention('1year')}
                className={`py-2 px-2.5 rounded-xl text-xs font-mono transition-all ${
                  retention === '1year'
                    ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 font-semibold'
                    : 'bg-white/5 text-slate-400'
                }`}
              >
                1 Year
              </button>
              <button
                type="button"
                onClick={() => setRetention('90days')}
                className={`py-2 px-2.5 rounded-xl text-xs font-mono transition-all ${
                  retention === '90days'
                    ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 font-semibold'
                    : 'bg-white/5 text-slate-400'
                }`}
              >
                90 Days
              </button>
            </div>
          </div>

          {/* Biometrics Toggle */}
          <div className="flex items-center justify-between py-2 border-t border-white/5">
            <div>
              <p className="text-xs font-medium text-slate-800 dark:text-white">
                Face ID / Biometric Lock
              </p>
              <p className="text-[11px] text-slate-500">Require unlock to view Memory Vault</p>
            </div>
            <button
              onClick={() => setBiometricLock(!biometricLock)}
              className={`w-11 h-6 rounded-full transition-colors relative ${
                biometricLock ? 'bg-indigo-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                  biometricLock ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>

          {/* Telemetry Toggle */}
          <div className="flex items-center justify-between py-2 border-t border-white/5">
            <div>
              <p className="text-xs font-medium text-slate-800 dark:text-white">
                Anonymous Crash Diagnostics
              </p>
              <p className="text-[11px] text-slate-500">Help improve the Twin local engine</p>
            </div>
            <button
              onClick={() => setTelemetry(!telemetry)}
              className={`w-11 h-6 rounded-full transition-colors relative ${
                telemetry ? 'bg-indigo-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                  telemetry ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>

          {/* Export & Reset Actions */}
          <div className="space-y-2 pt-2 border-t border-white/10">
            <button
              onClick={handleExport}
              className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-slate-300 flex items-center justify-center gap-2 border border-white/10"
            >
              <span className="material-symbols-outlined text-[16px]">file_download</span>
              <span>
                {exportNotice
                  ? '✓ Encrypted JSON Backup Prepared'
                  : 'Export Knowledge Graph (JSON)'}
              </span>
            </button>

            <button
              onClick={() => {
                if (confirm('Reset your Twin Memory Vault back to initial seed state?')) {
                  onResetVault();
                  onClose();
                }
              }}
              className="w-full py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-xs font-mono text-rose-400 flex items-center justify-center gap-2 border border-rose-500/20"
            >
              <span className="material-symbols-outlined text-[16px]">restart_alt</span>
              <span>Reset Vault to Default Seeds</span>
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
