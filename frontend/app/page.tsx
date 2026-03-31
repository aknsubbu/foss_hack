import Link from 'next/link';

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="card card-hover flex flex-col items-start gap-4 p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
        {icon}
      </div>
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">{title}</h3>
        <p className="text-sm text-slate-500 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function BoltIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <div className="flex flex-col">
      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-sky-50 py-24 sm:py-32">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -top-20 -right-20 h-96 w-96 rounded-full bg-indigo-100/50 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-96 w-96 rounded-full bg-sky-100/50 blur-3xl" />

        <div className="relative mx-auto max-w-4xl px-6 text-center">
          {/* Pill badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-4 py-1.5 text-xs font-semibold text-indigo-600 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
            Open Source Contribution Made Easy
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 mb-6 leading-tight">
            Find open source issues{' '}
            <span className="text-indigo-500">matched to your skills</span>
          </h1>

          <p className="mx-auto max-w-2xl text-lg sm:text-xl text-slate-500 mb-10 leading-relaxed">
            Stop scrolling through hundreds of issues. Get personalized
            recommendations based on your tech stack, experience, and goals.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/onboarding" className="btn-primary px-8 py-3 text-base gap-2">
              Get Started
              <ArrowRightIcon />
            </Link>
            <Link href="/browse" className="btn-secondary px-8 py-3 text-base">
              Browse Issues
            </Link>
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-3 gap-6 max-w-lg mx-auto">
            {[
              { value: '10k+', label: 'Issues Indexed' },
              { value: '500+', label: 'Repositories' },
              { value: '95%', label: 'Match Accuracy' },
            ].map(({ value, label }) => (
              <div key={label} className="text-center">
                <div className="text-2xl font-bold text-indigo-600">{value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-800 mb-3">
              Why FOSSHACK?
            </h2>
            <p className="text-slate-500 max-w-xl mx-auto">
              We analyze your skills and preferences to surface the best issues
              you can actually contribute to — right now.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            <FeatureCard
              icon={<BoltIcon />}
              title="Smart Matching"
              description="Our algorithm scores every issue against your tech stack, experience level, and domains — giving you a ranked list with reasons."
            />
            <FeatureCard
              icon={<UserIcon />}
              title="Personalized"
              description="Set up your profile once. The more you tell us about yourself, the better your recommendations become over time."
            />
            <FeatureCard
              icon={<ShieldIcon />}
              title="Quality Filtered"
              description="We surface Good First Issues with high quality scores, mentorship availability, and recent activity — so you don't waste time."
            />
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-br from-slate-50 to-indigo-50/30 py-20 px-6">
        <div className="mx-auto max-w-3xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-800 mb-3">
              How it works
            </h2>
            <p className="text-slate-500">Three simple steps to your first contribution.</p>
          </div>

          <div className="space-y-6">
            {[
              {
                step: '01',
                title: 'Tell us about yourself',
                description:
                  'Fill in your tech stack, domains you care about, experience level, and what types of issues you prefer.',
              },
              {
                step: '02',
                title: 'Get matched issues',
                description:
                  'We run your profile against thousands of open issues and rank them by how well they match your skills.',
              },
              {
                step: '03',
                title: 'Start contributing',
                description:
                  'Click through to the issue on GitHub, read the context, and make your first pull request.',
              },
            ].map(({ step, title, description }) => (
              <div key={step} className="card flex items-start gap-5">
                <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 font-bold text-sm">
                  {step}
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800 mb-1">{title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Link href="/onboarding" className="btn-primary px-8 py-3 text-base gap-2">
              Start now — it&apos;s free
              <ArrowRightIcon />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 py-8 px-6 text-center text-xs text-slate-400">
        <p>
          Built for FOSS Hackathon &middot; Powered by open source data &middot;{' '}
          <Link href="/browse" className="text-indigo-400 hover:text-indigo-600 transition-colors">
            Browse issues
          </Link>
        </p>
      </footer>
    </div>
  );
}
