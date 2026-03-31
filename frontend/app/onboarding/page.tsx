'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createUser } from '@/lib/api';
import type { Domain, ExperienceLevel, IssueType } from '@/lib/types';

// ── Step data ─────────────────────────────────────────────────────────────────

const QUICK_TECH = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Go',
  'Rust',
  'Java',
  'React',
  'Vue',
  'C++',
  'Ruby',
  'Swift',
  'Kotlin',
];

const ALL_DOMAINS: { key: Domain; label: string; emoji: string }[] = [
  { key: 'frontend',       label: 'Frontend',        emoji: '🖥️' },
  { key: 'backend',        label: 'Backend',         emoji: '🔧' },
  { key: 'devtools',       label: 'DevTools',        emoji: '🛠️' },
  { key: 'infrastructure', label: 'Infrastructure',  emoji: '☁️' },
  { key: 'ml',             label: 'ML / AI',         emoji: '🤖' },
  { key: 'mobile',         label: 'Mobile',          emoji: '📱' },
  { key: 'database',       label: 'Database',        emoji: '🗄️' },
  { key: 'security',       label: 'Security',        emoji: '🔒' },
  { key: 'testing',        label: 'Testing',         emoji: '🧪' },
  { key: 'docs',           label: 'Docs',            emoji: '📚' },
];

const EXPERIENCE_LEVELS: {
  key: ExperienceLevel;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    key: 'beginner',
    label: 'Beginner',
    description: 'New to open source or just starting with programming',
    icon: '🌱',
  },
  {
    key: 'intermediate',
    label: 'Intermediate',
    description: 'Comfortable with code, a few contributions under my belt',
    icon: '🚀',
  },
  {
    key: 'advanced',
    label: 'Advanced',
    description: 'Seasoned contributor, comfortable with complex codebases',
    icon: '⚡',
  },
];

const ISSUE_TYPES: { key: IssueType; label: string; description: string }[] = [
  { key: 'bug-fix',       label: 'Bug Fix',      description: 'Fix existing defects' },
  { key: 'feature',       label: 'Feature',      description: 'Build new functionality' },
  { key: 'documentation', label: 'Documentation',description: 'Improve docs & guides' },
  { key: 'tests',         label: 'Tests',        description: 'Add / improve test coverage' },
  { key: 'refactor',      label: 'Refactor',     description: 'Clean up & improve code structure' },
  { key: 'performance',   label: 'Performance',  description: 'Speed & efficiency improvements' },
];

const TOTAL_STEPS = 6;

// ── Helper components ─────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  const pct = Math.round((step / TOTAL_STEPS) * 100);
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2 text-xs text-slate-500">
        <span>Step {step} of {TOTAL_STEPS}</span>
        <span>{pct}% complete</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-bold text-slate-800">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [githubUsername, setGithubUsername] = useState('');
  const [techStack, setTechStack] = useState<string[]>([]);
  const [techInput, setTechInput] = useState('');
  const [domains, setDomains] = useState<Domain[]>([]);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | ''>('');
  const [preferredTypes, setPreferredTypes] = useState<IssueType[]>([]);
  const [prompt, setPrompt] = useState('');

  // ── Step navigation ──────────────────────────────────────────────────────────

  const canAdvance = (): boolean => {
    if (step === 2) return techStack.length > 0;
    if (step === 3) return domains.length > 0;
    if (step === 4) return experienceLevel !== '';
    return true;
  };

  const next = () => {
    if (step < TOTAL_STEPS) setStep((s) => s + 1);
  };

  const back = () => {
    if (step > 1) setStep((s) => s - 1);
  };

  // ── Tech stack helpers ───────────────────────────────────────────────────────

  const addTech = (tech: string) => {
    const trimmed = tech.trim();
    if (trimmed && !techStack.includes(trimmed)) {
      setTechStack((prev) => [...prev, trimmed]);
    }
    setTechInput('');
  };

  const removeTech = (tech: string) => {
    setTechStack((prev) => prev.filter((t) => t !== tech));
  };

  const handleTechKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && techInput.trim()) {
      e.preventDefault();
      addTech(techInput);
    }
    if (e.key === 'Backspace' && !techInput && techStack.length > 0) {
      setTechStack((prev) => prev.slice(0, -1));
    }
  };

  // ── Domain helpers ───────────────────────────────────────────────────────────

  const toggleDomain = (d: Domain) => {
    setDomains((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  };

  // ── Type helpers ─────────────────────────────────────────────────────────────

  const toggleType = (t: IssueType) => {
    setPreferredTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        ...(githubUsername.trim() ? { githubUsername: githubUsername.trim() } : {}),
        ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        techStack,
        domains,
        ...(experienceLevel ? { experienceLevel } : {}),
        ...(preferredTypes.length > 0 ? { preferredTypes } : {}),
      };

      const user = await createUser(payload);
      localStorage.setItem('fosshack_user_id', user.id);
      router.push(`/dashboard?userId=${user.id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
      setSubmitting(false);
    }
  };

  // ── Render steps ─────────────────────────────────────────────────────────────

  const renderStep = () => {
    switch (step) {
      // ── Step 1: GitHub username ──────────────────────────────────────────────
      case 1:
        return (
          <div>
            <StepHeading
              title="What's your GitHub username?"
              subtitle="Optional — we'll use it to understand your existing contributions and tech stack."
            />
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="github">
                  GitHub Username
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                    @
                  </span>
                  <input
                    id="github"
                    type="text"
                    className="input pl-8"
                    placeholder="your-username"
                    value={githubUsername}
                    onChange={(e) => setGithubUsername(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && next()}
                    autoFocus
                  />
                </div>
              </div>
              <p className="text-xs text-slate-400">
                We only read public profile info. No login required.
              </p>
            </div>
          </div>
        );

      // ── Step 2: Tech stack ───────────────────────────────────────────────────
      case 2:
        return (
          <div>
            <StepHeading
              title="What's your tech stack?"
              subtitle="Add languages, frameworks, and tools you know. Select from quick-add chips or type your own."
            />
            <div className="space-y-4">
              {/* Tag input */}
              <div>
                <label className="label">Your tech stack</label>
                <div className="min-h-[48px] flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-200 transition">
                  {techStack.map((tech) => (
                    <span
                      key={tech}
                      className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700"
                    >
                      {tech}
                      <button
                        type="button"
                        onClick={() => removeTech(tech)}
                        className="ml-0.5 text-indigo-400 hover:text-indigo-700 transition-colors"
                        aria-label={`Remove ${tech}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    className="flex-1 min-w-[100px] text-sm outline-none placeholder:text-slate-400"
                    placeholder={techStack.length === 0 ? 'Type and press Enter…' : ''}
                    value={techInput}
                    onChange={(e) => setTechInput(e.target.value)}
                    onKeyDown={handleTechKeyDown}
                    onBlur={() => techInput.trim() && addTech(techInput)}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1.5">Press Enter or comma to add</p>
              </div>

              {/* Quick-add chips */}
              <div>
                <p className="text-xs font-medium text-slate-500 mb-2">Quick add:</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_TECH.filter((t) => !techStack.includes(t)).map((tech) => (
                    <button
                      key={tech}
                      type="button"
                      onClick={() => addTech(tech)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                    >
                      + {tech}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );

      // ── Step 3: Domains ──────────────────────────────────────────────────────
      case 3:
        return (
          <div>
            <StepHeading
              title="What domains interest you?"
              subtitle="Select all that apply — we'll prioritize issues in these areas."
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {ALL_DOMAINS.map(({ key, label, emoji }) => {
                const selected = domains.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleDomain(key)}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all duration-150 ${
                      selected
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-200'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/50'
                    }`}
                  >
                    <span className="text-2xl">{emoji}</span>
                    <span className="text-xs font-medium leading-tight">{label}</span>
                  </button>
                );
              })}
            </div>
            {domains.length > 0 && (
              <p className="text-xs text-indigo-600 mt-3">
                {domains.length} selected
              </p>
            )}
          </div>
        );

      // ── Step 4: Experience level ─────────────────────────────────────────────
      case 4:
        return (
          <div>
            <StepHeading
              title="What's your experience level?"
              subtitle="This helps us calibrate issue difficulty to your comfort zone."
            />
            <div className="space-y-3">
              {EXPERIENCE_LEVELS.map(({ key, label, description, icon }) => {
                const selected = experienceLevel === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setExperienceLevel(key)}
                    className={`w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-all duration-150 ${
                      selected
                        ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200'
                        : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/50'
                    }`}
                  >
                    <span className="text-2xl">{icon}</span>
                    <div>
                      <div className={`text-sm font-semibold ${selected ? 'text-indigo-700' : 'text-slate-800'}`}>
                        {label}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{description}</div>
                    </div>
                    <div className="ml-auto">
                      <div
                        className={`h-4 w-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                          selected
                            ? 'border-indigo-500 bg-indigo-500'
                            : 'border-slate-300'
                        }`}
                      >
                        {selected && (
                          <div className="h-1.5 w-1.5 rounded-full bg-white" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );

      // ── Step 5: Issue types ──────────────────────────────────────────────────
      case 5:
        return (
          <div>
            <StepHeading
              title="What types of issues do you prefer?"
              subtitle="Optional — select as many as you like."
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ISSUE_TYPES.map(({ key, label, description }) => {
                const checked = preferredTypes.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleType(key)}
                    className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-all duration-150 ${
                      checked
                        ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200'
                        : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/50'
                    }`}
                  >
                    <div
                      className={`h-5 w-5 rounded-md border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                        checked
                          ? 'border-indigo-500 bg-indigo-500'
                          : 'border-slate-300'
                      }`}
                    >
                      {checked && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <div className={`text-sm font-medium ${checked ? 'text-indigo-700' : 'text-slate-700'}`}>
                        {label}
                      </div>
                      <div className="text-xs text-slate-500">{description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );

      // ── Step 6: Free-text prompt ─────────────────────────────────────────────
      case 6:
        return (
          <div>
            <StepHeading
              title="Anything else to tell us?"
              subtitle="Optional — describe what you want to work on in your own words."
            />
            <div className="space-y-3">
              <label className="label" htmlFor="prompt">
                Your goals (free text)
              </label>
              <textarea
                id="prompt"
                rows={5}
                className="input resize-none"
                placeholder="e.g. I want to fix bugs in React tools, improve TypeScript typings, or work on anything related to CLI tooling…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-slate-400">
                This is optional. Skip it if you prefer.
              </p>
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50/40 via-white to-sky-50/30 flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-xl">
        {/* Card */}
        <div className="card p-8">
          {/* Logo */}
          <div className="flex items-center gap-2 mb-8">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500 text-white text-xs font-bold">
              F
            </div>
            <span className="text-sm font-semibold text-slate-600">
              FOSS<span className="text-indigo-500">HACK</span> — Onboarding
            </span>
          </div>

          <ProgressBar step={step} />

          {/* Step content */}
          <div key={step} className="animate-in fade-in duration-200">
            {renderStep()}
          </div>

          {/* Navigation buttons */}
          <div className="mt-8 flex items-center justify-between gap-4">
            {step > 1 ? (
              <button
                type="button"
                onClick={back}
                className="btn-secondary"
                disabled={submitting}
              >
                ← Back
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-3">
              {/* Skip button for optional steps */}
              {(step === 1 || step === 5 || step === 6) && (
                <button
                  type="button"
                  onClick={step === 6 ? handleSubmit : next}
                  className="btn-ghost text-slate-400"
                  disabled={submitting}
                >
                  {step === 6 ? 'Skip & Finish' : 'Skip'}
                </button>
              )}

              {step < TOTAL_STEPS ? (
                <button
                  type="button"
                  onClick={next}
                  className="btn-primary"
                  disabled={!canAdvance()}
                >
                  Continue →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="btn-primary min-w-[140px]"
                  disabled={submitting}
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Processing…
                    </span>
                  ) : (
                    'Get Recommendations →'
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Step dots */}
        <div className="mt-6 flex items-center justify-center gap-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i + 1 === step
                  ? 'w-6 bg-indigo-500'
                  : i + 1 < step
                  ? 'w-3 bg-indigo-300'
                  : 'w-3 bg-slate-200'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
