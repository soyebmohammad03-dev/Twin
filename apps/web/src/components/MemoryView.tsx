import React, { useState, useMemo } from 'react';
import { MemoryItem, MemoryCategory } from '../types';

interface MemoryViewProps {
  memories: MemoryItem[];
  onOpenCapture: () => void;
  onSelectMemory: (mem: MemoryItem) => void;
}

export const MemoryView: React.FC<MemoryViewProps> = ({
  memories,
  onOpenCapture,
  onSelectMemory,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<MemoryCategory | 'all'>('all');

  const categories: { id: MemoryCategory | 'all'; label: string; icon: string }[] = [
    { id: 'all', label: 'All', icon: 'grid_view' },
    { id: 'people', label: 'People', icon: 'group' },
    { id: 'projects', label: 'Projects', icon: 'folder' },
    { id: 'ideas', label: 'Ideas', icon: 'lightbulb' },
    { id: 'decisions', label: 'Decisions', icon: 'gavel' },
  ];

  const filteredMemories = useMemo(() => {
    return memories.filter((mem) => {
      const matchesCat = selectedCategory === 'all' || mem.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return matchesCat;
      const matchesSearch =
        mem.title.toLowerCase().includes(q) ||
        mem.description.toLowerCase().includes(q) ||
        (mem.tags && mem.tags.some((t) => t.toLowerCase().includes(q))) ||
        (mem.linkedEntity && mem.linkedEntity.toLowerCase().includes(q)) ||
        (mem.personRole && mem.personRole.toLowerCase().includes(q));
      return matchesCat && matchesSearch;
    });
  }, [memories, selectedCategory, searchQuery]);

  const getCategoryColor = (cat: MemoryCategory) => {
    switch (cat) {
      case 'decisions':
        return 'text-emerald-500 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'ideas':
        return 'text-amber-500 dark:text-[#ffbd9b] bg-amber-500/10 border-amber-500/20';
      case 'people':
        return 'text-indigo-500 dark:text-[#c2c1ff] bg-indigo-500/10 border-indigo-500/20';
      case 'projects':
        return 'text-violet-500 dark:text-[#bdc2ff] bg-violet-500/10 border-violet-500/20';
    }
  };

  const getCategoryIcon = (cat: MemoryCategory) => {
    switch (cat) {
      case 'decisions':
        return 'gavel';
      case 'ideas':
        return 'lightbulb';
      case 'people':
        return 'person';
      case 'projects':
        return 'folder';
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto w-full pb-32 pt-2">
      {/* View Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Memory Vault
          </h1>
          <p className="text-sm text-slate-600 dark:text-[#c7c4d6]/80 mt-1">
            Personal knowledge graph, decisions, people, and captured insights
          </p>
        </div>

        <button
          onClick={onOpenCapture}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all active:scale-95 shadow-md"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          <span>Add Memory</span>
        </button>
      </div>

      {/* Search Bar Slab */}
      <div className="liquid-glass-heavy rounded-2xl p-2.5 flex items-center gap-3 border border-slate-200/90 dark:border-white/10 shadow-lg focus-within:ring-2 focus-within:ring-indigo-500/40 relative group">
        <div className="specular-highlight absolute inset-0 pointer-events-none opacity-20 rounded-2xl" />
        <span className="material-symbols-outlined text-slate-400 pl-2 text-xl">
          search
        </span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="What are you trying to remember? (e.g. Berlin, Sarah, Tailwind)"
          className="flex-1 bg-transparent border-none outline-none text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#918f9f] text-sm sm:text-base focus:ring-0 p-0"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        )}
      </div>

      {/* Filter Chips */}
      <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
        {categories.map((cat) => {
          const isActive = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-mono flex items-center gap-1.5 shrink-0 transition-all cursor-pointer ${
                isActive
                  ? 'bg-indigo-600 dark:bg-white text-white dark:text-black font-semibold shadow-xs scale-102'
                  : 'liquid-glass text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:bg-white/10'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">{cat.icon}</span>
              <span>{cat.label}</span>
              {cat.id !== 'all' && (
                <span className="opacity-60 text-[10px]">
                  (
                  {
                    memories.filter((m) =>
                      cat.id === 'all' ? true : m.category === cat.id
                    ).length
                  }
                  )
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Timeline Node List */}
      <div className="relative mt-2">
        {/* Continuous vertical timeline connector line */}
        <div className="absolute left-4 sm:left-5 top-4 bottom-6 w-px bg-gradient-to-b from-indigo-500/40 via-white/15 to-transparent pointer-events-none" />

        <div className="space-y-6">
          {filteredMemories.length === 0 ? (
            <div className="liquid-glass rounded-2xl p-8 text-center ml-10">
              <span className="material-symbols-outlined text-4xl text-slate-400">
                search_off
              </span>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 mt-2">
                No memories match your filter
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Try searching for another keyword or capture a new memory.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                }}
                className="mt-4 px-4 py-1.5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-mono hover:bg-indigo-500/30"
              >
                Reset filters
              </button>
            </div>
          ) : (
            filteredMemories.map((mem) => {
              const catColor = getCategoryColor(mem.category);
              const catIcon = getCategoryIcon(mem.category);

              return (
                <div key={mem.id} className="relative flex gap-4 sm:gap-5 group">
                  {/* Timeline Node Indicator */}
                  <div className="flex flex-col items-center shrink-0 z-10">
                    <div
                      className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full liquid-glass flex items-center justify-center border shadow-md transition-transform group-hover:scale-110 ${catColor}`}
                    >
                      <span className="material-symbols-outlined text-[17px]">
                        {catIcon}
                      </span>
                    </div>
                  </div>

                  {/* Card Content */}
                  <div
                    onClick={() => onSelectMemory(mem)}
                    className="flex-1 liquid-glass rounded-2xl p-4 sm:p-5 border border-white/10 hover:border-indigo-400/40 transition-all duration-300 relative overflow-hidden shadow-md group-hover:-translate-y-0.5 cursor-pointer"
                  >
                    <div className="specular-highlight absolute inset-0 pointer-events-none opacity-20 rounded-2xl" />

                    <div className="flex flex-col gap-2 relative z-10">
                      {/* Meta header */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span
                            className={`font-mono text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-md border ${catColor}`}
                          >
                            {mem.category.slice(0, -1)}
                          </span>
                          <h3 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-white mt-1.5">
                            {mem.title}
                          </h3>
                        </div>

                        <div className="flex flex-col items-end gap-1 text-right shrink-0">
                          <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 bg-white/5 px-2 py-0.5 rounded border border-white/10 flex items-center gap-1">
                            {mem.sourceType === 'voice' && (
                              <span className="material-symbols-outlined text-[13px] text-indigo-400">
                                graphic_eq
                              </span>
                            )}
                            {mem.source}
                          </span>
                          <span className="font-mono text-[10px] text-slate-500">
                            {mem.date}
                          </span>
                        </div>
                      </div>

                      {/* Person Card Special Header */}
                      {mem.category === 'people' && mem.personRole && (
                        <div className="flex items-center gap-3 py-1">
                          {mem.imageUrl && (
                            <img
                              src={mem.imageUrl}
                              alt={mem.title}
                              className="w-10 h-10 rounded-full object-cover border border-white/20 shadow-sm"
                            />
                          )}
                          <div>
                            <p className="text-xs font-mono text-indigo-500 dark:text-indigo-300">
                              {mem.personRole}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Description / Content */}
                      <p className="text-sm text-slate-700 dark:text-[#c7c4d6] leading-relaxed">
                        {mem.description}
                      </p>

                      {/* Voice Note simulated waveform */}
                      {mem.sourceType === 'voice' && (
                        <div className="flex items-center gap-1 py-1.5 opacity-80">
                          <div className="waveform-bar bg-indigo-400" style={{ animationDelay: '0.1s' }} />
                          <div className="waveform-bar bg-indigo-400" style={{ animationDelay: '0.3s' }} />
                          <div className="waveform-bar bg-indigo-400" style={{ animationDelay: '0.5s' }} />
                          <div className="waveform-bar bg-indigo-400" style={{ animationDelay: '0.2s' }} />
                          <div className="waveform-bar bg-indigo-400" style={{ animationDelay: '0.7s' }} />
                          <div className="waveform-bar bg-indigo-400" style={{ animationDelay: '0.4s' }} />
                          <div className="waveform-bar bg-indigo-400" style={{ animationDelay: '0.6s' }} />
                          <div className="waveform-bar bg-indigo-400" style={{ animationDelay: '0.3s' }} />
                          <span className="font-mono text-[10px] text-slate-400 ml-2">
                            Voice recording transcribed with 98.4% confidence
                          </span>
                        </div>
                      )}

                      {/* Attached Image Preview */}
                      {mem.imageUrl && mem.category !== 'people' && (
                        <div className="w-full h-36 sm:h-44 rounded-xl overflow-hidden relative mt-1 border border-white/10">
                          <img
                            src={mem.imageUrl}
                            alt={mem.title}
                            className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-500"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                        </div>
                      )}

                      {/* Tags & Linked Entity footer */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5">
                        <div className="flex flex-wrap gap-1.5">
                          {mem.tags?.map((tag, i) => (
                            <span
                              key={i}
                              className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-600 dark:text-slate-400 border border-white/5"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>

                        {mem.linkedEntity && (
                          <div className="flex items-center gap-1 text-[11px] font-mono text-indigo-400">
                            <span className="material-symbols-outlined text-[13px]">link</span>
                            <span>Linked: {mem.linkedEntity}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
