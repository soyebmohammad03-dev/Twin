import React from 'react';
import { TabType } from '../types';

interface BottomNavBarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({ currentTab, onSelectTab }) => {
  const tabs: { id: TabType; label: string; icon: string; filledIcon: string }[] = [
    { id: 'home', label: 'Home', icon: 'home', filledIcon: 'home' },
    { id: 'twin', label: 'Twin', icon: 'smart_toy', filledIcon: 'smart_toy' },
    { id: 'memory', label: 'Memory', icon: 'database', filledIcon: 'history_edu' },
    { id: 'explore', label: 'Explore', icon: 'hub', filledIcon: 'explore' },
    { id: 'profile', label: 'Profile', icon: 'person', filledIcon: 'person' },
  ];

  return (
    <nav className="fixed bottom-14 sm:bottom-16 left-1/2 -translate-x-1/2 w-[92%] max-w-md z-40">
      <div className="bg-white/90 dark:bg-black/60 backdrop-blur-2xl border border-slate-200/90 dark:border-white/15 rounded-full px-2 py-1.5 flex items-center justify-between shadow-xl shadow-slate-900/10 dark:shadow-2xl dark:shadow-black/70 transition-all duration-300">
        {tabs.map((tab) => {
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`relative flex flex-col items-center justify-center transition-all duration-300 rounded-full select-none cursor-pointer ${
                isActive
                  ? 'bg-indigo-600 text-white px-4 sm:px-5 py-1.5 shadow-lg shadow-indigo-600/30 scale-100 font-semibold'
                  : 'text-slate-500 hover:text-slate-900 dark:text-white/50 dark:hover:text-white px-3 sm:px-3.5 py-1.5 hover:bg-slate-100/80 dark:hover:bg-white/5'
              }`}
            >
              <span
                className="material-symbols-outlined text-[20px] transition-transform"
                style={{
                  fontVariationSettings: isActive ? "'FILL' 1, 'wght' 600" : "'FILL' 0, 'wght' 400",
                }}
              >
                {isActive ? tab.filledIcon : tab.icon}
              </span>
              <span className="font-mono text-[9px] sm:text-[10px] tracking-wider uppercase mt-0.5 font-medium">
                {tab.label}
              </span>

              {/* Specular highlight for active tab */}
              {isActive && (
                <div className="absolute inset-0 rounded-full bg-gradient-to-t from-transparent via-white/10 to-white/20 pointer-events-none" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
