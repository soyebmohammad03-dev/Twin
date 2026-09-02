import React, { useState } from 'react';
import { GraphNode } from '../types';

interface ExploreViewProps {
  nodes: GraphNode[];
  onDeepExploration: () => void;
  onAskAboutNode: (node: GraphNode) => void;
}

export const ExploreView: React.FC<ExploreViewProps> = ({
  nodes,
  onDeepExploration,
  onAskAboutNode,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string>('node-helios');
  const [activeClusterFilter, setActiveClusterFilter] = useState<string>('all');

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || nodes[0];

  const filteredNodes = nodes.filter((n) => {
    if (activeClusterFilter === 'all') return true;
    return n.cluster.toLowerCase() === activeClusterFilter.toLowerCase();
  });

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full pb-32 pt-2">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full liquid-glass text-xs font-mono text-[#4f4ccd] dark:text-[#c2c1ff] border border-indigo-500/30 mb-2">
            <span className="material-symbols-outlined text-[14px]">hub</span>
            <span>Knowledge Graph Overview</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Explore Clusters
          </h1>
          <p className="text-sm text-slate-600 dark:text-[#c7c4d6]/80 mt-1">
            Uncover hidden relationships between people, projects, ideas, decisions, and goals.
          </p>
        </div>

        <button
          onClick={onDeepExploration}
          className="liquid-glass-heavy px-5 py-2.5 rounded-full flex items-center gap-2 hover:bg-indigo-500/20 transition-all border border-indigo-500/40 shadow-lg group active:scale-95 cursor-pointer self-start sm:self-auto"
        >
          <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-[#c2c1ff]">
            Deep Exploration
          </span>
          <span className="material-symbols-outlined text-[18px] text-indigo-500 dark:text-[#c2c1ff] group-hover:translate-x-1 transition-transform">
            arrow_forward
          </span>
        </button>
      </div>

      {/* Main Grid: Interactive Canvas & Side Clusters */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Interactive Knowledge Graph Canvas */}
        <div className="lg:col-span-8 liquid-glass rounded-3xl p-5 sm:p-6 min-h-[460px] sm:min-h-[540px] relative overflow-hidden flex flex-col justify-between border border-slate-200/80 dark:border-white/10 shadow-xl group">
          {/* Subtle grid background */}
          <div
            className="absolute inset-0 opacity-[0.04] pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(circle at 2px 2px, currentColor 1.5px, transparent 0)',
              backgroundSize: '28px 28px',
            }}
          />

          {/* Canvas Top Bar */}
          <div className="relative z-10 flex items-center justify-between">
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
              Interactive Neural Map • Tap node to inspect
            </span>

            <button
              onClick={() => setSelectedNodeId('node-helios')}
              className="text-xs font-mono text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
            >
              Reset focus
            </button>
          </div>

          {/* Graph Nodes and SVG Connections Area */}
          <div className="relative w-full h-80 sm:h-96 my-auto">
            {/* SVG Connecting Lines between selected node and connected nodes */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
              <defs>
                <linearGradient id="linkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#4f4ccd" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#818cf8" stopOpacity="0.2" />
                </linearGradient>
              </defs>

              {/* Central Helios connections */}
              <line x1="38%" y1="50%" x2="68%" y2="28%" stroke="url(#linkGrad)" strokeWidth="1.5" strokeDasharray="3 3" />
              <line x1="38%" y1="50%" x2="72%" y2="72%" stroke="url(#linkGrad)" strokeWidth="1.5" />
              <line x1="38%" y1="50%" x2="15%" y2="30%" stroke="url(#linkGrad)" strokeWidth="1.5" strokeDasharray="2 2" />
              <line x1="38%" y1="50%" x2="20%" y2="78%" stroke="url(#linkGrad)" strokeWidth="1.5" />
              <line x1="72%" y1="72%" x2="68%" y2="28%" stroke="#918f9f" strokeWidth="1" strokeOpacity="0.3" />
            </svg>

            {/* Central Node: Project Helios */}
            <div
              onClick={() => setSelectedNodeId('node-helios')}
              className={`absolute top-1/2 left-[38%] -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1.5 cursor-pointer transition-transform ${
                selectedNodeId === 'node-helios' ? 'scale-110' : 'hover:scale-105'
              }`}
            >
              <div
                className={`w-16 h-16 rounded-2xl liquid-glass-heavy flex items-center justify-center border transition-all ${
                  selectedNodeId === 'node-helios'
                    ? 'border-indigo-500 dark:border-indigo-400 shadow-[0_0_30px_rgba(79,76,205,0.4)]'
                    : 'border-slate-300 dark:border-white/20'
                }`}
              >
                <span className="material-symbols-outlined text-3xl text-indigo-600 dark:text-indigo-400">
                  rocket_launch
                </span>
              </div>
              <span className="font-mono text-xs text-slate-800 dark:text-white bg-white/90 dark:bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-md border border-slate-200 dark:border-white/10 font-semibold shadow-xs">
                Project Helios
              </span>
            </div>

            {/* Connected Node: Sarah Jenkins (Person) */}
            <div
              onClick={() => setSelectedNodeId('node-sarah')}
              className={`absolute top-[72%] left-[72%] -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1.5 cursor-pointer transition-transform ${
                selectedNodeId === 'node-sarah' ? 'scale-110' : 'hover:scale-105'
              }`}
            >
              <div
                className={`w-14 h-14 rounded-full overflow-hidden border-2 transition-all ${
                  selectedNodeId === 'node-sarah'
                    ? 'border-indigo-500 dark:border-indigo-400 shadow-[0_0_24px_rgba(129,140,248,0.5)]'
                    : 'border-slate-300 dark:border-white/20'
                }`}
              >
                <img
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuCSMQ6nZUoE_xaRMfpaj5WLxiePidtIcUR_VLwxlYioc2lzb-DOoScKIdyA63EMtFXI_REeaMVfqXvNtqHehIe5Dc_Qt4kPaXjIIm7ildkXkhA7c54KTVVRKGCyxeOyt7aU_9GDTyTt0OsgRCM4fKzcR3XRJQFpGUUwGR35uD2nBnzuqkSYC4egLg0q0coBnNhYNg9rCqwUAyiRcMXBZXAEdQIjBA4b2E2XTwMNDcOL6k6Y_6AoFK7eZw"
                  alt="Sarah"
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="font-mono text-xs text-slate-800 dark:text-white bg-white/90 dark:bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-md border border-slate-200 dark:border-white/10 font-medium shadow-xs">
                Sarah
              </span>
            </div>

            {/* Connected Node: Budget Decision (Goal) */}
            <div
              onClick={() => setSelectedNodeId('node-budget')}
              className={`absolute top-[28%] left-[68%] -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1.5 cursor-pointer transition-transform ${
                selectedNodeId === 'node-budget' ? 'scale-110' : 'hover:scale-105'
              }`}
            >
              <div
                className={`w-13 h-13 rounded-2xl liquid-glass flex items-center justify-center border transition-all ${
                  selectedNodeId === 'node-budget'
                    ? 'border-amber-500 dark:border-amber-400 shadow-[0_0_24px_rgba(255,183,133,0.4)]'
                    : 'border-slate-300 dark:border-white/20'
                }`}
              >
                <span className="material-symbols-outlined text-2xl text-amber-500 dark:text-amber-400">
                  account_balance_wallet
                </span>
              </div>
              <span className="font-mono text-xs text-slate-800 dark:text-white bg-white/90 dark:bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-md border border-slate-200 dark:border-white/10 shadow-xs">
                Budget Decision
              </span>
            </div>

            {/* Connected Node: Past Architecture v1 (Memory) */}
            <div
              onClick={() => setSelectedNodeId('node-v1arch')}
              className={`absolute top-[30%] left-[15%] -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1.5 cursor-pointer transition-transform ${
                selectedNodeId === 'node-v1arch' ? 'scale-110' : 'hover:scale-105'
              }`}
            >
              <div
                className={`w-11 h-11 rounded-full liquid-glass flex items-center justify-center border transition-all ${
                  selectedNodeId === 'node-v1arch'
                    ? 'border-indigo-500 dark:border-indigo-400 shadow-sm'
                    : 'border-slate-300 dark:border-white/15'
                }`}
              >
                <span className="material-symbols-outlined text-lg text-slate-500 dark:text-slate-400">
                  history
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-700 dark:text-slate-400 bg-white/90 dark:bg-black/40 px-2 py-0.5 rounded border border-slate-200 dark:border-white/5 shadow-xs">
                V1 Arch
              </span>
            </div>

            {/* Connected Node: Design System */}
            <div
              onClick={() => setSelectedNodeId('node-design')}
              className={`absolute top-[78%] left-[20%] -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1.5 cursor-pointer transition-transform ${
                selectedNodeId === 'node-design' ? 'scale-110' : 'hover:scale-105'
              }`}
            >
              <div
                className={`w-11 h-11 rounded-2xl liquid-glass flex items-center justify-center border transition-all ${
                  selectedNodeId === 'node-design'
                    ? 'border-violet-500 dark:border-violet-400 shadow-sm'
                    : 'border-slate-300 dark:border-white/15'
                }`}
              >
                <span className="material-symbols-outlined text-lg text-violet-500 dark:text-violet-400">
                  palette
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-700 dark:text-slate-400 bg-white/90 dark:bg-black/40 px-2 py-0.5 rounded border border-slate-200 dark:border-white/5 shadow-xs">
                Liquid Glass
              </span>
            </div>
          </div>

          {/* Bottom Canvas Selected Node Bar */}
          <div className="relative z-10 liquid-glass rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-slate-200/80 dark:border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-indigo-400 text-xl">
                  {selectedNode.icon}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
                    {selectedNode.name}
                  </h4>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400">
                    {selectedNode.cluster}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-[#c7c4d6] line-clamp-1 mt-0.5">
                  {selectedNode.description}
                </p>
              </div>
            </div>

            <button
              onClick={() => onAskAboutNode(selectedNode)}
              className="px-3.5 py-1.5 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all shrink-0 cursor-pointer shadow-sm text-center"
            >
              Ask Twin about this
            </button>
          </div>
        </div>

        {/* Side Column: Clusters & Context Synth */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Active Clusters Breakdown */}
          <div className="liquid-glass rounded-3xl p-5 border border-slate-200/80 dark:border-white/10 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                Active Clusters
              </h3>
              <span className="material-symbols-outlined text-slate-400 text-lg">
                filter_list
              </span>
            </div>

            <div className="space-y-3">
              {/* Projects Cluster */}
              <div
                onClick={() =>
                  setActiveClusterFilter(
                    activeClusterFilter === 'projects' ? 'all' : 'projects'
                  )
                }
                className={`flex items-start gap-3 p-3 rounded-2xl transition-all cursor-pointer border ${
                  activeClusterFilter === 'projects'
                    ? 'bg-indigo-500/15 dark:bg-indigo-500/20 border-indigo-500/40'
                    : 'hover:bg-slate-100/70 dark:hover:bg-white/5 border-transparent'
                }`}
              >
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-indigo-600 dark:text-indigo-400 text-[20px]">
                    folder_open
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Projects
                    </h4>
                    <span className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
                      12 active
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                    4 connected in memory graph
                  </p>
                </div>
              </div>

              {/* People Cluster */}
              <div
                onClick={() =>
                  setActiveClusterFilter(
                    activeClusterFilter === 'people' ? 'all' : 'people'
                  )
                }
                className={`flex items-start gap-3 p-3 rounded-2xl transition-all cursor-pointer border ${
                  activeClusterFilter === 'people'
                    ? 'bg-amber-500/15 dark:bg-amber-500/20 border-amber-500/40'
                    : 'hover:bg-slate-100/70 dark:hover:bg-white/5 border-transparent'
                }`}
              >
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-[20px]">
                    group
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      People
                    </h4>
                    <span className="text-[11px] font-mono text-amber-600 dark:text-amber-400 font-semibold">
                      8 people
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                    2 active this week
                  </p>
                </div>
              </div>

              {/* Goals Cluster */}
              <div
                onClick={() =>
                  setActiveClusterFilter(
                    activeClusterFilter === 'goals' ? 'all' : 'goals'
                  )
                }
                className={`flex items-start gap-3 p-3 rounded-2xl transition-all cursor-pointer border ${
                  activeClusterFilter === 'goals'
                    ? 'bg-rose-500/15 dark:bg-rose-500/20 border-rose-500/40'
                    : 'hover:bg-slate-100/70 dark:hover:bg-white/5 border-transparent'
                }`}
              >
                <div className="w-9 h-9 rounded-xl bg-rose-500/10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-rose-600 dark:text-rose-400 text-[20px]">
                    flag
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Goals & Decisions
                    </h4>
                    <span className="text-[11px] font-mono text-rose-600 dark:text-rose-400 font-semibold">
                      3 pending
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                    1 blocker: House budget
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Context Note / Memory Synth Card */}
          <div className="liquid-glass rounded-3xl p-5 border border-slate-200/80 dark:border-white/10 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-mono text-indigo-600 dark:text-indigo-400">
                <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
                <span>Context Synthesis</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/10">
                Memory Synth
              </span>
            </div>

            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#c7c4d6]/90 mt-2">
              "Sarah requested an update on the Q3 Budget Decision for Project Helios. The architecture v1 was referenced alongside your savings goal."
            </p>

            <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-white/5 flex items-center justify-between">
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                Confidence: 94.2%
              </span>
              <button
                onClick={onDeepExploration}
                className="text-xs font-mono text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                Generate Report
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
