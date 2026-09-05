import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../context/AppContext';
import { INITIAL_USER } from '../data/mockData';

interface SignUpViewProps {
  onNavigateToSignIn: () => void;
}

interface FieldErrors {
  fullName?: string;
  email?: string;
  handle?: string;
  password?: string;
  confirmPassword?: string;
  general?: string;
}

export const SignUpView: React.FC<SignUpViewProps> = ({ onNavigateToSignIn }) => {
  const { signUp } = useApp();

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Password visibility controls
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Interaction & submission states
  const [touched, setTouched] = useState<{ [key: string]: boolean }>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Auto-suggest handle from full name if handle hasn't been manually typed
  useEffect(() => {
    if (!touched.handle && fullName.trim()) {
      const sanitized = fullName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      if (sanitized) {
        setHandle(`@${sanitized}`);
      }
    }
  }, [fullName, touched.handle]);

  // Validation logic
  const validate = (submitAttempt = false): boolean => {
    const newErrors: FieldErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Full Name
    if (!fullName.trim()) {
      newErrors.fullName = 'Full name is required.';
    } else if (fullName.trim().length < 2) {
      newErrors.fullName = 'Name must be at least 2 characters.';
    }

    // Email
    if (!email.trim()) {
      newErrors.email = 'Account email is required.';
    } else if (!emailRegex.test(email.trim())) {
      newErrors.email = 'Please enter a valid email address (e.g. name@domain.com).';
    }

    // Password
    if (!password) {
      newErrors.password = 'Vault passcode is required.';
    } else if (password.length < 8) {
      newErrors.password = 'Passcode must be at least 8 characters.';
    }

    // Confirm Password
    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your passcode.';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passcodes do not match.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    validate();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Mark all as touched
    setTouched({
      fullName: true,
      email: true,
      handle: true,
      password: true,
      confirmPassword: true,
    });

    const isValid = validate(true);
    if (!isValid) return;

    setIsLoading(true);
    setErrors({});

    try {
      await signUp({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        password: password.trim(),
        handle: handle.trim() || undefined,
      });

      // Show brief success transition before entering app
      setIsSuccess(true);
      await new Promise((resolve) => setTimeout(resolve, 750));
    } catch (err: any) {
      const msg = err?.message || 'Failed to create your Twin vault. Please try again.';
      setErrors((prev) => ({
        ...prev,
        general: msg,
        // If message is about email duplicate, highlight email field
        ...(msg.toLowerCase().includes('email') ? { email: msg } : {}),
      }));
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-3 sm:p-6 py-8 relative overflow-x-hidden">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[550px] h-[550px] bg-gradient-to-br from-indigo-600/15 via-purple-600/15 to-transparent rounded-full blur-[130px]" />
        <div className="absolute bottom-10 right-10 w-[350px] h-[350px] bg-indigo-500/10 rounded-full blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -16, scale: 0.98 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md my-auto"
      >
        {/* Main Card */}
        <div className="liquid-glass-heavy rounded-3xl p-5 sm:p-7 border border-white/15 dark:border-white/10 light:border-slate-200/90 shadow-2xl relative overflow-hidden backdrop-blur-3xl text-slate-900 dark:text-white">
          {/* Header */}
          <div className="flex flex-col items-center text-center mb-5 sm:mb-6">
            <div className="w-14 h-14 rounded-2xl bg-white/5 dark:bg-white/5 light:bg-indigo-50 border border-white/15 light:border-indigo-100 flex items-center justify-center p-2.5 shadow-lg mb-3 relative">
              <img
                src={INITIAL_USER.twinSymbolUrl}
                alt="Twin Logo"
                className="w-full h-full object-contain filter drop-shadow-[0_0_12px_rgba(194,193,255,0.7)]"
              />
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-[#0a0a0b] light:border-white shadow-[0_0_8px_#34d399]" />
            </div>

            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
              Create your Twin account
            </h1>
            <p className="text-xs text-slate-500 dark:text-white/60 mt-1 max-w-xs leading-relaxed">
              Establish your personal intelligence model, encrypted vault, and private cognition space.
            </p>
          </div>

          {/* General Error Banner */}
          {errors.general && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs flex items-start gap-2"
            >
              <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">error</span>
              <span>{errors.general}</span>
            </motion.div>
          )}

          {/* Sign Up Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
            {/* Full Name */}
            <div className="space-y-1">
              <label
                htmlFor="signup-name"
                className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block"
              >
                Full Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="signup-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: undefined }));
                  }}
                  onBlur={() => handleBlur('fullName')}
                  placeholder="e.g. Jordan Hayes"
                  disabled={isLoading || isSuccess}
                  className={`w-full py-2.5 px-3.5 pl-10 rounded-xl bg-white/5 light:bg-slate-50 border text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 focus:outline-none transition-all ${
                    touched.fullName && errors.fullName
                      ? 'border-rose-500/60 focus:ring-2 focus:ring-rose-500/30'
                      : 'border-slate-200 dark:border-white/15 focus:ring-2 focus:ring-indigo-500/50'
                  }`}
                />
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 dark:text-white/40 text-[18px]">
                  person
                </span>
              </div>
              {touched.fullName && errors.fullName && (
                <p className="text-[11px] text-rose-500 dark:text-rose-400 font-mono mt-0.5 pl-1">
                  {errors.fullName}
                </p>
              )}
            </div>

            {/* Email Address */}
            <div className="space-y-1">
              <label
                htmlFor="signup-email"
                className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block"
              >
                Account Email <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  onBlur={() => handleBlur('email')}
                  placeholder="jordan.hayes@example.com"
                  disabled={isLoading || isSuccess}
                  className={`w-full py-2.5 px-3.5 pl-10 rounded-xl bg-white/5 light:bg-slate-50 border text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 focus:outline-none transition-all ${
                    touched.email && errors.email
                      ? 'border-rose-500/60 focus:ring-2 focus:ring-rose-500/30'
                      : 'border-slate-200 dark:border-white/15 focus:ring-2 focus:ring-indigo-500/50'
                  }`}
                />
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 dark:text-white/40 text-[18px]">
                  alternate_email
                </span>
              </div>
              {touched.email && errors.email && (
                <p className="text-[11px] text-rose-500 dark:text-rose-400 font-mono mt-0.5 pl-1">
                  {errors.email}
                </p>
              )}
            </div>

            {/* Username / Handle (Optional) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="signup-handle"
                  className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60"
                >
                  Vault Handle <span className="text-[10px] text-slate-400 dark:text-white/40 font-normal lowercase">(optional)</span>
                </label>
                <span className="text-[10px] text-indigo-500 font-mono">
                  Identity Token
                </span>
              </div>
              <div className="relative">
                <input
                  id="signup-handle"
                  type="text"
                  value={handle}
                  onChange={(e) => {
                    setHandle(e.target.value);
                    setTouched((prev) => ({ ...prev, handle: true }));
                  }}
                  placeholder="@jordanhayes"
                  disabled={isLoading || isSuccess}
                  className="w-full py-2.5 px-3.5 pl-10 rounded-xl bg-white/5 light:bg-slate-50 border border-slate-200 dark:border-white/15 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono"
                />
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 dark:text-white/40 text-[18px]">
                  badge
                </span>
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="signup-password"
                  className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60"
                >
                  Vault Passcode <span className="text-rose-500">*</span>
                </label>
                <span className="text-[10px] text-indigo-500 font-mono">
                  Min. 8 chars
                </span>
              </div>
              <div className="relative">
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  onBlur={() => handleBlur('password')}
                  placeholder="Create master passcode..."
                  disabled={isLoading || isSuccess}
                  className={`w-full py-2.5 px-3.5 pl-10 pr-10 rounded-xl bg-white/5 light:bg-slate-50 border text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 focus:outline-none transition-all ${
                    touched.password && errors.password
                      ? 'border-rose-500/60 focus:ring-2 focus:ring-rose-500/30'
                      : 'border-slate-200 dark:border-white/15 focus:ring-2 focus:ring-indigo-500/50'
                  }`}
                />
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 dark:text-white/40 text-[18px]">
                  key
                </span>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:text-white/40 dark:hover:text-white transition-colors cursor-pointer"
                  title={showPassword ? 'Hide passcode' : 'Show passcode'}
                  aria-label={showPassword ? 'Hide passcode' : 'Show passcode'}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
              {touched.password && errors.password && (
                <p className="text-[11px] text-rose-500 dark:text-rose-400 font-mono mt-0.5 pl-1">
                  {errors.password}
                </p>
              )}
            </div>

            {/* Confirm Password Field */}
            <div className="space-y-1">
              <label
                htmlFor="signup-confirm-password"
                className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block"
              >
                Confirm Vault Passcode <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="signup-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (errors.confirmPassword)
                      setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                  }}
                  onBlur={() => handleBlur('confirmPassword')}
                  placeholder="Re-enter passcode..."
                  disabled={isLoading || isSuccess}
                  className={`w-full py-2.5 px-3.5 pl-10 pr-10 rounded-xl bg-white/5 light:bg-slate-50 border text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 focus:outline-none transition-all ${
                    touched.confirmPassword && errors.confirmPassword
                      ? 'border-rose-500/60 focus:ring-2 focus:ring-rose-500/30'
                      : 'border-slate-200 dark:border-white/15 focus:ring-2 focus:ring-indigo-500/50'
                  }`}
                />
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 dark:text-white/40 text-[18px]">
                  lock_reset
                </span>
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:text-white/40 dark:hover:text-white transition-colors cursor-pointer"
                  title={showConfirmPassword ? 'Hide passcode' : 'Show passcode'}
                  aria-label={showConfirmPassword ? 'Hide passcode' : 'Show passcode'}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {showConfirmPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
              {touched.confirmPassword && errors.confirmPassword && (
                <p className="text-[11px] text-rose-500 dark:text-rose-400 font-mono mt-0.5 pl-1">
                  {errors.confirmPassword}
                </p>
              )}
            </div>

            {/* Primary Action Button */}
            <button
              type="submit"
              id="signup-submit-btn"
              disabled={isLoading || isSuccess}
              className="w-full mt-3 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white font-medium text-sm shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>Encrypting Local Vault...</span>
                </>
              ) : isSuccess ? (
                <>
                  <span className="material-symbols-outlined text-[18px]">verified_user</span>
                  <span>Your Twin is Ready</span>
                </>
              ) : (
                <>
                  <span>Create Twin Account</span>
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </>
              )}
            </button>
          </form>

          {/* Navigation link to Sign In */}
          <div className="pt-4 mt-5 border-t border-slate-200 dark:border-white/10 flex flex-col items-center gap-2 text-center">
            <p className="text-xs text-slate-500 dark:text-white/60">
              Already have a Twin vault account?
            </p>
            <button
              type="button"
              id="auth-go-to-signin-btn"
              onClick={onNavigateToSignIn}
              disabled={isLoading || isSuccess}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-100/70 hover:bg-slate-200/70 dark:bg-white/5 dark:hover:bg-white/10 text-slate-800 dark:text-white font-medium text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:border-indigo-400/40"
            >
              <span>Sign in to existing account</span>
              <span className="material-symbols-outlined text-[16px] text-indigo-500">login</span>
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
