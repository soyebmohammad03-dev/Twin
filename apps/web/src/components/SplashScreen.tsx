import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { INITIAL_USER } from '../data/mockData';

interface SplashScreenProps {
  onComplete: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<'intro' | 'glow' | 'exit'>('intro');

  useEffect(() => {
    // Stage 1: Glow / Pulse
    const timer1 = setTimeout(() => {
      setStage('glow');
    }, 600);

    // Stage 2: Exit fade
    const timer2 = setTimeout(() => {
      setStage('exit');
    }, 1600);

    // Stage 3: Complete transition
    const timer3 = setTimeout(() => {
      onComplete();
    }, 2000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [onComplete]);

  return (
    <AnimatePresence>
      <motion.div
        key="twin-splash"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, scale: 1.02 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-[#050505] text-white select-none overflow-hidden"
      >
        {/* Ambient Cosmic Radial Glows */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-gradient-to-tr from-indigo-600/20 via-purple-600/25 to-pink-600/10 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute bottom-10 right-1/4 w-[320px] h-[320px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-sm">
          {/* Animated Twin Infinity Symbol Core */}
          <div className="relative mb-6">
            {/* Pulsing ring aura */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{
                scale: stage === 'glow' ? [1, 1.15, 1.05] : 1,
                opacity: stage === 'glow' ? [0.4, 0.8, 0.6] : 0.4,
              }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute -inset-4 rounded-full bg-gradient-to-r from-indigo-500/30 via-purple-500/40 to-pink-500/20 blur-xl pointer-events-none"
            />

            {/* Orbiting ring */}
            <div className="absolute -inset-2 rounded-full border border-indigo-400/25 animate-[spin_10s_linear_infinite]" />

            {/* Emblem container */}
            <motion.div
              initial={{ scale: 0.7, opacity: 0, rotate: -15 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-white/[0.04] border border-white/20 backdrop-blur-2xl flex items-center justify-center p-5 shadow-[0_0_50px_rgba(99,102,241,0.35)] relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-transparent pointer-events-none" />
              <img
                src={INITIAL_USER.twinSymbolUrl}
                alt="Twin Intelligence"
                className="w-full h-full object-contain filter drop-shadow-[0_0_20px_rgba(194,193,255,0.8)]"
              />
            </motion.div>
          </div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="text-3xl sm:text-4xl font-light tracking-tight text-white"
          >
            Twin
          </motion.h1>

          {/* Brand Tagline */}
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.6 }}
            className="text-xs sm:text-sm text-white/60 font-normal mt-2 leading-relaxed tracking-wide"
          >
            An evolving personal intelligence model
          </motion.p>

          {/* Syncing Indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="mt-8 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] font-mono text-indigo-300"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Loading your Twin</span>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
