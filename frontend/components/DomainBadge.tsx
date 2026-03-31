import type { Domain } from '@/lib/types';

const config: Record<Domain, { label: string; emoji: string; className: string }> = {
  frontend:      { label: 'Frontend',        emoji: '🖥️', className: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  backend:       { label: 'Backend',         emoji: '🔧', className: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
  devtools:      { label: 'DevTools',        emoji: '🛠️', className: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200' },
  infrastructure:{ label: 'Infrastructure',  emoji: '☁️', className: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  ml:            { label: 'ML',              emoji: '🤖', className: 'bg-pink-50 text-pink-700 ring-1 ring-pink-200' },
  mobile:        { label: 'Mobile',          emoji: '📱', className: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  database:      { label: 'Database',        emoji: '🗄️', className: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200' },
  security:      { label: 'Security',        emoji: '🔒', className: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  testing:       { label: 'Testing',         emoji: '🧪', className: 'bg-lime-50 text-lime-700 ring-1 ring-lime-200' },
  docs:          { label: 'Docs',            emoji: '📚', className: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200' },
};

interface Props {
  domain: Domain;
  showEmoji?: boolean;
  size?: 'sm' | 'md';
}

export default function DomainBadge({ domain, showEmoji = true, size = 'sm' }: Props) {
  const cfg = config[domain];
  if (!cfg) return null;
  const sizeClass = size === 'md' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClass} ${cfg.className}`}>
      {showEmoji && <span className="text-[10px]">{cfg.emoji}</span>}
      {cfg.label}
    </span>
  );
}
