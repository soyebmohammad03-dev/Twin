import React from 'react';
import { TwinModelProfile, ActiveThread } from '../types';
import { INITIAL_USER } from '../data/mockData';
import { useApp } from '../context/AppContext';

interface ProfileViewProps {
  profile: TwinModelProfile;
  threads: ActiveThread[];
  onOpenPrivacy: () => void;
  onSelectTab: (tab: 'home' | 'twin' | 'memory' | 'explore' | 'profile') => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  profile,
  threads,
  onOpenPrivacy,
}) => {
  const { userProfile, resolvedTheme } = useApp();
  const isDark = resolvedTheme === 'dark';
  const activeAvatar = isDark
    ? userProfile?.avatarUrl || INITIAL_USER.avatarUrl
    : userProfile?.lightAvatarUrl || userProfile?.avatarUrl || INITIAL_USER.lightAvatarUrl;
  const activeName = userProfile?.name || INITIAL_USER.name;
  const activeEmail = userProfile?.email || INITIAL_USER.email;
  const activeHandle = userProfile?.handle || INITIAL_USER.handle;

  return (
    <div className="flex flex-col gap-6 sm:gap-8 max-w-2xl mx-auto w-full pb-36 pt-2">
      {/* Active User Identity Banner */}
      <div className="w-full liquid-glass rounded-3xl p-4 sm:p-5 border border-slate-200/80 dark:border-white/10 flex items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-indigo-500/50 shadow-md shrink-0">
            <img
              src={activeAvatar}
              alt={activeName}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">
                {activeName}
              </h2>
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30">
                VERIFIED
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-white/60 font-mono truncate">
              {activeEmail} • {activeHandle}
            </p>
          </div>
        </div>
        <div className="hidden sm:flex flex-col items-end text-right text-[11px] font-mono text-slate-400 dark:text-white/40 shrink-0">
          <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Zero-Telemetry Node
          </span>
          <span className="truncate max-w-[140px]">{userProfile?.role || 'Twin Architect'}</span>
        </div>
      </div>

      {/* Hero / Identity Node */}
      <section className="flex flex-col items-center justify-center text-center relative py-2">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-indigo-500/10 dark:bg-indigo-500/15 blur-[60px] rounded-full pointer-events-none" />

        <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full border border-white/20 liquid-glass-heavy flex items-center justify-center p-4 shadow-2xl twin-core-glow group">
          <div className="absolute inset-0 rounded-full border border-indigo-400/30 animate-[spin_12s_linear_infinite]" />
          <img
            src={INITIAL_USER.twinSymbolUrl}
            alt="Twin Core"
            className="w-full h-full object-contain relative z-10 filter drop-shadow-[0_0_16px_rgba(194,193,255,0.7)] group-hover:scale-105 transition-transform duration-500"
          />
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white mt-4">
          {userProfile?.displayName ? `${userProfile.displayName}'s Neural Core` : profile.name}
        </h1>
        <p className="text-sm text-slate-600 dark:text-[#c7c4d6]/80 mt-0.5">
          An evolving personal intelligence model of your world.
        </p>

        <div className="mt-3 inline-flex items-center gap-2 px-3.5 py-1 rounded-full liquid-glass border border-indigo-400/30 text-xs font-mono text-[#4f4ccd] dark:text-[#c2c1ff]">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>{profile.status}</span>
          <span className="text-slate-400 opacity-60">• {profile.codename}</span>
        </div>
      </section>

      {/* What Twin Knows (Bento Grid) */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 px-1">
          <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-xl">database</span>
          What Twin Knows
        </h3>

        <div className="grid grid-cols-2 gap-3.5">
          {/* Knowledge Entities (Large) */}
          <div className="col-span-2 rounded-3xl liquid-glass p-5 sm:p-6 border border-slate-200/80 dark:border-white/10 relative overflow-hidden group">
            <div className="specular-highlight absolute inset-0 pointer-events-none opacity-20 rounded-3xl" />
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Knowledge Base
              </span>
              <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-[20px]">
                memory
              </span>
            </div>
            <div className="flex items-baseline gap-2.5 mt-3">
              <span className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white">
                {profile.entitiesCount}
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                discrete interconnected entities
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Cross-indexed with semantic relations across conversations, notes, and decisions.
            </p>
          </div>

          {/* People */}
          <div className="col-span-1 rounded-2xl liquid-glass p-4 sm:p-5 border border-slate-200/80 dark:border-white/10 flex flex-col justify-between">
            <div className="flex items-center justify-between text-indigo-500 dark:text-indigo-400">
              <span className="font-mono text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                People
              </span>
              <span className="material-symbols-outlined text-[18px]">group</span>
            </div>
            <div className="mt-3">
              <span className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                {profile.peopleCount}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">
                collaborators
              </span>
            </div>
          </div>

          {/* Goals */}
          <div className="col-span-1 rounded-2xl liquid-glass p-4 sm:p-5 border border-slate-200/80 dark:border-white/10 flex flex-col justify-between">
            <div className="flex items-center justify-between text-amber-500 dark:text-amber-400">
              <span className="font-mono text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Goals
              </span>
              <span className="material-symbols-outlined text-[18px]">flag</span>
            </div>
            <div className="mt-3">
              <span className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                {profile.goalsCount}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">
                tracked priorities
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Model Status Confidence Bar */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 px-1">
          <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-xl">analytics</span>
          Model Calibration
        </h3>

        <div className="liquid-glass rounded-3xl p-5 sm:p-6 border border-slate-200/80 dark:border-white/10 space-y-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate-500 dark:text-slate-400">
            <span>Memory Confidence Distribution</span>
            <span>Local Core v2.4</span>
          </div>

          {/* Confidence segmented bar */}
          <div className="h-4 w-full bg-slate-200 dark:bg-white/10 rounded-full flex overflow-hidden p-0.5 shadow-inner">
            <div
              className="h-full bg-indigo-600 dark:bg-[#c2c1ff] rounded-l-full transition-all duration-700"
              style={{ width: `${profile.explicitRatio}%` }}
              title="Explicit Confirmed"
            />
            <div
              className="h-full bg-violet-400 opacity-80 transition-all duration-700"
              style={{ width: `${profile.inferredRatio}%` }}
              title="Inferred Context"
            />
            <div
              className="h-full bg-slate-400 dark:bg-slate-500 opacity-40 rounded-r-full transition-all duration-700"
              style={{ width: `${profile.uncertainRatio}%` }}
              title="Uncertain Pending Clarification"
            />
          </div>

          {/* Legend */}
          <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-mono">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#4f4ccd] dark:bg-[#c2c1ff]" />
                <span className="text-slate-800 dark:text-white font-medium">Explicit</span>
              </div>
              <span className="text-slate-500 pl-4">{profile.explicitRatio}%</span>
            </div>

            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-violet-400 opacity-80" />
                <span className="text-slate-800 dark:text-white font-medium">Inferred</span>
              </div>
              <span className="text-slate-500 pl-4">{profile.inferredRatio}%</span>
            </div>

            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-slate-500 opacity-40" />
                <span className="text-slate-800 dark:text-white font-medium">Uncertain</span>
              </div>
              <span className="text-slate-500 pl-4">{profile.uncertainRatio}%</span>
            </div>
          </div>

          {/* Model Status checklist */}
          <div className="pt-3 border-t border-slate-200/70 dark:border-white/5 space-y-2">
            <div className="flex items-center justify-between text-xs sm:text-sm py-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_8px_rgba(52,199,89,0.8)]" />
                <span className="text-slate-800 dark:text-white">Confirmed Memories</span>
              </div>
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                {profile.confirmedMemoriesStatus}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs sm:text-sm py-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400 shadow-[0_0_8px_rgba(255,189,155,0.8)]" />
                <span className="text-slate-800 dark:text-white">Growing Insights</span>
              </div>
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                {profile.growingInsightsStatus}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs sm:text-sm py-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-400 shadow-[0_0_8px_rgba(255,204,0,0.8)]" />
                <span className="text-slate-800 dark:text-white">Needs Clarification</span>
              </div>
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                {profile.needsClarificationStatus}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Active Threads */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 px-1">
          <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-xl">workspaces</span>
          Active Background Threads
        </h3>

        <div className="space-y-2.5">
          {threads.map((thread) => (
            <div
              key={thread.id}
              className="liquid-glass rounded-2xl p-4 flex items-center justify-between hover:border-indigo-400/40 transition-all border border-slate-200/80 dark:border-white/10 cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
                  style={{
                    backgroundColor: `${thread.color}15`,
                    borderColor: `${thread.color}40`,
                    color: thread.color,
                  }}
                >
                  <span className="material-symbols-outlined text-[20px]">{thread.icon}</span>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {thread.title}
                  </h4>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                    {thread.subtitle}
                  </p>
                </div>
              </div>

              <span className="material-symbols-outlined text-slate-400 text-lg">
                chevron_right
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Growth Patterns Visual */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 px-1">
          <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-xl">trending_up</span>
          Knowledge Evolution
        </h3>

        <div className="liquid-glass rounded-3xl p-5 border border-slate-200/80 dark:border-white/10 relative overflow-hidden">
          <div className="flex items-end justify-between h-28 px-4 gap-3 relative z-10">
            <div className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
              <div className="w-full bg-slate-200 dark:bg-white/10 rounded-t-lg h-[22%]" />
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">May</span>
            </div>
            <div className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
              <div className="w-full bg-slate-200 dark:bg-white/10 rounded-t-lg h-[35%]" />
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">Jun</span>
            </div>
            <div className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
              <div className="w-full bg-slate-200 dark:bg-white/10 rounded-t-lg h-[40%]" />
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">Jul</span>
            </div>
            <div className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
              <div className="w-full bg-slate-300 dark:bg-white/20 rounded-t-lg h-[58%]" />
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">Aug</span>
            </div>
            <div className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
              <div className="w-full bg-indigo-500/50 rounded-t-lg h-[76%] relative">
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-indigo-400 dark:bg-indigo-300" />
              </div>
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">Sep</span>
            </div>
            <div className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
              <div className="w-full bg-indigo-500 dark:bg-indigo-400 rounded-t-lg h-[95%] relative shadow-[0_0_20px_rgba(129,140,248,0.5)]">
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow-sm" />
              </div>
              <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-bold">Now</span>
            </div>
          </div>
        </div>
      </section>

      {/* Privacy Configuration Button */}
      <div className="flex justify-center pt-2">
        <button
          onClick={onOpenPrivacy}
          className="px-6 py-3 rounded-full liquid-glass border border-slate-200/80 dark:border-white/15 text-xs font-mono uppercase tracking-widest text-slate-800 dark:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-white/10 transition-all flex items-center gap-2 active:scale-95 cursor-pointer shadow-md"
        >
          <span className="material-symbols-outlined text-[18px] text-indigo-500 dark:text-indigo-400">
            shield_lock
          </span>
          <span>Privacy &amp; Memory Settings</span>
        </button>
      </div>
    </div>
  );
};
