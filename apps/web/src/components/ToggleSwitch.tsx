import React from 'react';

interface ToggleSwitchProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  color?: 'indigo' | 'emerald' | 'amber' | 'purple';
  size?: 'sm' | 'md';
  ariaLabel?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  id,
  checked,
  onChange,
  disabled = false,
  color = 'indigo',
  size = 'md',
  ariaLabel,
}) => {
  const colorClasses = {
    indigo: checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-white/20',
    emerald: checked ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-white/20',
    amber: checked ? 'bg-amber-600' : 'bg-slate-300 dark:bg-white/20',
    purple: checked ? 'bg-purple-600' : 'bg-slate-300 dark:bg-white/20',
  };

  const isSmall = size === 'sm';
  const trackWidth = isSmall ? 'w-9' : 'w-11';
  const trackHeight = isSmall ? 'h-5' : 'h-6';
  const knobSize = isSmall ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const knobLeft = isSmall
    ? checked ? 'translate-x-4' : 'translate-x-0.5'
    : checked ? 'translate-x-5' : 'translate-x-1';

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) {
          onChange(!checked);
        }
      }}
      className={`
        relative inline-flex shrink-0 items-center rounded-full
        ${trackWidth} ${trackHeight} ${colorClasses[color]}
        transition-colors duration-200 ease-in-out
        focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span
        aria-hidden="true"
        className={`
          pointer-events-none inline-block rounded-full bg-white shadow-sm ring-0
          ${knobSize} transform transition-transform duration-200 ease-in-out
          ${knobLeft}
        `}
      />
    </button>
  );
};
