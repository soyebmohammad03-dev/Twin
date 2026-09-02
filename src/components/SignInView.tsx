import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useApp } from '../context/AppContext';
import { INITIAL_USER } from '../data/mockData';

interface SignInViewProps {
  onNavigateToSignUp?: () => void;
}

export const SignInView: React.FC<SignInViewProps> = ({ onNavigateToSignUp }) => {
  const { signIn, signInDemo, resolvedTheme } = useApp();
  const isDark = resolvedTheme === 'dark';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Basic validation
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter your account email or handle.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your vault passcode.');
      return;
    }

    setIsLoading(true);

    try {
      // Small simulated cryptographic verification delay for tactile feedback
      await new Promise((resolve) => setTimeout(resolve, 550));
      await signIn(trimmedEmail, password);
      setIsSuccess(true);
      await new Promise((resolve) => setTimeout(resolve, 350));
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'Invalid email or vault passcode. Please check your credentials or sign up.'
      );
      setIsLoading(false);
    }
  };

  const handleQuickDemoSignIn = async () => {
    setErrorMessage(null);
    setEmail(INITIAL_USER.email);
    setPassword('••••••••••••');
    setIsLoading(true);

    try {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await signInDemo();
      setIsSuccess(true);
      await new Promise((resolve) => setTimeout(resolve, 350));
    } catch (err: any) {
      setErrorMessage(err?.message || 'Demo login failed. Please retry.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 relative overflow-x-hidden">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[550px] h-[550px] bg-gradient-to-br from-indigo-600/15 via-purple-600/15 to-transparent rounded-full blur-[130px]" />
        <div className="absolute bottom-10 right-10 w-[350px] h-[350px] bg-indigo-500/10 rounded-full blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md"
      >
        {/* Main Card */}
        <div className="liquid-glass-heavy rounded-3xl p-6 sm:p-8 border border-white/15 dark:border-white/10 light:border-slate-200/90 shadow-2xl relative overflow-hidden backdrop-blur-3xl">
          {/* Header */}
          <div className="flex flex-col items-center text-center mb-6 sm:mb-8">
            <div className="w-16 h-16 rounded-2xl bg-white/5 dark:bg-white/5 light:bg-indigo-50 border border-white/15 light:border-indigo-100 flex items-center justify-center p-3 shadow-lg mb-4 relative">
              <img
                src={INITIAL_USER.twinSymbolUrl}
                alt="Twin Core"
                className="w-full h-full object-contain filter drop-shadow-[0_0_12px_rgba(194,193,255,0.7)]"
              />
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-[#0a0a0b] light:border-white shadow-[0_0_8px_#34d399]" />
            </div>

            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
              Welcome to Twin
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-white/60 mt-1.5 max-w-xs">
              Access your personal intelligence model, encrypted memories, and private cognition vault.
            </p>
          </div>

          {/* Quick Demo Login Preset Button */}
          <div className="mb-6">
            <button
              type="button"
              onClick={handleQuickDemoSignIn}
              disabled={isLoading}
              className="w-full p-3.5 rounded-2xl bg-gradient-to-r from-indigo-500/15 via-purple-500/15 to-indigo-500/10 hover:from-indigo-500/25 hover:to-purple-500/25 border border-indigo-500/30 text-left transition-all active:scale-[0.98] group flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-indigo-400/50 shrink-0">
                  <img
                    src={isDark ? INITIAL_USER.avatarUrl : INITIAL_USER.lightAvatarUrl}
                    alt={INITIAL_USER.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors truncate">
                      Continue as Alex Rivera
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                      PRO
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-white/50 truncate font-mono">
                    {INITIAL_USER.email}
                  </p>
                </div>
              </div>
              <span className="material-symbols-outlined text-indigo-500 group-hover:translate-x-1 transition-transform text-lg shrink-0">
                arrow_forward
              </span>
            </button>
          </div>

          {/* Divider with "OR" */}
          <div className="relative flex items-center justify-center my-5">
            <div className="w-full border-t border-slate-200 dark:border-white/10" />
            <span className="absolute px-3 bg-slate-100 dark:bg-[#0e0f17] text-[10px] font-mono uppercase tracking-widest text-slate-400 dark:text-white/40 rounded-full border border-slate-200 dark:border-white/10">
              Or Custom Session
            </span>
          </div>

          {/* Error Message Box */}
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs flex items-start gap-2"
            >
              <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">
                error
              </span>
              <span>{errorMessage}</span>
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Identity / Email Field */}
            <div className="space-y-1.5">
              <label
                htmlFor="signin-email"
                className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block"
              >
                Account Email or Handle
              </label>
              <div className="relative">
                <input
                  id="signin-email"
                  type="text"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="alex.rivera@twin.ai"
                  disabled={isLoading}
                  className="w-full py-2.5 px-3.5 pl-10 rounded-xl bg-white/5 light:bg-slate-50 border border-slate-200 dark:border-white/15 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                />
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 dark:text-white/40 text-[18px]">
                  alternate_email
                </span>
              </div>
            </div>

            {/* Password / Passcode Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="signin-password"
                  className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60"
                >
                  Vault Passcode / Key
                </label>
                <span className="text-[10px] text-indigo-500 font-mono">
                  AES-256 GCM
                </span>
              </div>
              <div className="relative">
                <input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Enter vault key..."
                  disabled={isLoading}
                  className="w-full py-2.5 px-3.5 pl-10 pr-10 rounded-xl bg-white/5 light:bg-slate-50 border border-slate-200 dark:border-white/15 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                />
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 dark:text-white/40 text-[18px]">
                  key
                </span>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:text-white/40 dark:hover:text-white"
                  title={showPassword ? 'Hide passcode' : 'Show passcode'}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>

            {/* Primary Submit Button */}
            <button
              type="submit"
              disabled={isLoading || isSuccess}
              className="w-full mt-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white font-medium text-sm shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>Decrypting Local Vault...</span>
                </>
              ) : isSuccess ? (
                <>
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span>Session Verified</span>
                </>
              ) : (
                <>
                  <span>Unlock Twin Vault</span>
                  <span className="material-symbols-outlined text-[18px]">lock_open</span>
                </>
              )}
            </button>
          </form>

          {/* Create Account Section */}
          <div className="pt-4 mt-5 border-t border-slate-200/80 dark:border-white/10 flex flex-col items-center gap-2 text-center">
            <p className="text-xs text-slate-500 dark:text-white/60">
              Don't have an account?
            </p>
            <button
              type="button"
              id="auth-go-to-signup-btn"
              onClick={onNavigateToSignUp}
              disabled={isLoading || isSuccess}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-100/70 hover:bg-slate-200/70 dark:bg-white/5 dark:hover:bg-white/10 text-slate-800 dark:text-white font-medium text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:border-indigo-400/40"
            >
              <span>Create your Twin account</span>
              <span className="material-symbols-outlined text-[16px] text-indigo-500">person_add</span>
            </button>
          </div>

          {/* Security Guarantee Notice */}
          <div className="mt-5 pt-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-center gap-2 text-[11px] font-mono text-slate-500 dark:text-white/40 text-center">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            <span>Zero-Telemetry Guarantee • Strictly On-Device Storage</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
