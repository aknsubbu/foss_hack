import type { Difficulty } from '@/lib/types';

const config: Record<
  Difficulty,
  { label: string; className: string }
> = {
  easy: {
    label: 'Easy',
    className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  },
  medium: {
    label: 'Medium',
    className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  },
  hard: {
    label: 'Hard',
    className: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  },
};

interface Props {
  difficulty: Difficulty;
  size?: 'sm' | 'md';
}

export default function DifficultyBadge({ difficulty, size = 'sm' }: Props) {
  const { label, className } = config[difficulty] ?? config.medium;
  const sizeClass = size === 'md' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClass} ${className}`}>
      {label}
    </span>
  );
}
