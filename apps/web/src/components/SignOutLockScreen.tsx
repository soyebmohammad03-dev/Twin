import React, { useState } from 'react';
import { INITIAL_USER } from '../data/mockData';

interface SignOutLockScreenProps {
  onUnlock: () => void;
  isDark: boolean;
}

export const SignOutLockScreen: React.FC<SignOutLockScreenProps> = ({ onUnlock, isDark }) => {
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleUnlock = () => {
    setIsAuthenticating(true);
    setTimeout(() => {
      setIsAuthenticating(false);
      onUnlock();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#050505]/95 backdrop-blur-3xl animate-fadeIn">
      {/* Frosted Cosmic Background Glows */}
      <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-indigo-600/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/3 w-96 h-96 bg-purple-600/15 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-sm p-8 rounded-[2.5rem] bg-white/5 border border-white/10 backdrop-blur-2xl shadow-2xl flex flex-col items-center text-center relative z-10">
        {/* Lock indicator */}
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-indigo-400/40 p-1 shadow-[0_0_25px_rgba(99,102,241,0.3)]">
            <img
              src={isDark ? INITIAL_USER.avatarUrl : INITIAL_USER.lightAvatarUrl}
              alt={INITIAL_USER.name}
              className="w-full h-full object-cover rounded-full"
            />
          </div>
          <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-indigo-600 border-2 border-[#050505] flex items-center justify-center text-white shadow">
            <span className="material-symbols-outlined text-[16px]">lock</span>
          </div>
        </div>

        <h2 className="text-2xl font-light text-white tracking-tight">
          Vault Locked
        </h2>
        <p className="text-sm text-white/80 font-medium mt-1">
          {INITIAL_USER.name}
        </p>
        <p className="text-xs font-mono text-white/40 mt-0.5">
          {INITIAL_USER.email}
        </p>

        <div className="my-6 p-3 rounded-2xl bg-white/[0.04] border border-white/5 w-full text-xs text-white/60 font-mono flex items-center justify-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          <span>Local Vector DB Encrypted (AES-256)</span>
        </div>

        {/* Primary Unlock Button */}
        <button
          onClick={handleUnlock}
          disabled={isAuthenticating}
          className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-indigo-500 via-purple-600 to-indigo-600 hover:opacity-95 text-white font-semibold text-sm shadow-[0_0_20px_rgba(99,102,241,0.4)] transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
        >
          {isAuthenticating ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              <span>Verifying Cryptographic Keys...</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[20px]">fingerprint</span>
              <span>Unlock Vault Session</span>
            </>
          )}
        </button>

        <p className="text-[11px] text-white/30 font-mono mt-4">
          Key: {INITIAL_USER.encryptionKeyId} • Node NY-042
        </p>
      </div>
    </div>
  );
};
