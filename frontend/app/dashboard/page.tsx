'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { getRecommendations, getUser } from '@/lib/api';
import type {
  Freshness,
  IssueType,
  Recommendation,
  RecommendationFilters,
  UserProfile,
} from '@/lib/types';
import IssueCard from '@/components/IssueCard';
import DomainBadge from '@/components/DomainBadge';
import DifficultyBadge from '@/components/DifficultyBadge';
import { IssueCardSkeleton, ProfileSidebarSkeleton } from '@/components/LoadingSkeleton';

// ── Sidebar ───────────────────────────────────────────────────────────────────

function ProfileSidebar({ user }: { user: UserProfile }) {
  return (
    <aside className="w-full lg:w-72 xl:w-80 flex-shrink-0">
      <div className="card sticky top-20 space-y-5">
        {/* Avatar + name */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 font-bold text-lg flex-shrink-0">
            {user.githubUsername
              ? user.githubUsername.charAt(0).toUpperCase()
              : 'U'}
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-800">
              {user.githubUsername ?? 'Anonymous'}
            </div>
            <div className="text-xs text-slate-500 capitalize">
              {user.experienceLevel} developer
            </div>
          </div>
        </div>

        {/* Experience */}
        <div>
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
            Experience
          </div>
          <span className="capitalize text-sm font-medium text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
            {user.experienceLevel}
          </span>
        </div>

        {/* Domains */}
        {user.domains.length > 0 && (
          <div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Domains
            </div>
            <div className="flex flex-wrap gap-1.5">
              {user.domains.map((d) => (
                <DomainBadge key={d} domain={d} size="md" />
              ))}
            </div>
          </div>
        )}

        {/* Tech stack */}
        {user.techStack.length > 0 && (
          <div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Tech Stack
            </div>
            <div className="flex flex-wrap gap-1.5">
              {user.techStack.slice(0, 12).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Preferred difficulty */}
        {user.preferredDifficulty && (
          <div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Preferred Difficulty
            </div>
            <DifficultyBadge difficulty={user.preferredDifficulty} size="md" />
          </div>
        )}

        {/* Skills */}
        {user.skills && user.skills.length > 0 && (
          <div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Skills
            </div>
            <div className="flex flex-wrap gap-1.5">
              {user.skills.slice(0, 8).map((s) => (
                <span
                  key={s}
                  className="rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Edit profile */}
        <a
          href="/onboarding"
          className="btn-secondary w-full text-xs mt-2"
        >
          Update Profile
        </a>
      </div>
    </aside>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

interface FilterBarProps {
  filters: RecommendationFilters;
  onChange: (f: RecommendationFilters) => void;
  loading: boolean;
}

function FilterBar({ filters, onChange, loading }: FilterBarProps) {
  return (
    <div className="card p-4 flex flex-wrap items-end gap-4 mb-6">
      {/* Freshness */}
      <div className="flex-1 min-w-[130px]">
        <label className="label text-xs">Freshness</label>
        <select
          className="input text-sm"
          value={filters.freshness ?? ''}
          onChange={(e) =>
            onChange({ ...filters, freshness: (e.target.value as Freshness) || undefined })
          }
          disabled={loading}
        >
          <option value="">Any</option>
          <option value="fresh">Fresh (&lt; 7 days)</option>
          <option value="recent">Recent (&lt; 30 days)</option>
        </select>
      </div>

      {/* Type */}
      <div className="flex-1 min-w-[130px]">
        <label className="label text-xs">Issue Type</label>
        <select
          className="input text-sm"
          value={filters.type ?? ''}
          onChange={(e) =>
            onChange({ ...filters, type: (e.target.value as IssueType) || undefined })
          }
          disabled={loading}
        >
          <option value="">Any Type</option>
          <option value="bug-fix">Bug Fix</option>
          <option value="feature">Feature</option>
          <option value="documentation">Documentation</option>
          <option value="tests">Tests</option>
          <option value="refactor">Refactor</option>
          <option value="performance">Performance</option>
        </select>
      </div>

      {/* Min quality */}
      <div className="flex-1 min-w-[130px]">
        <label className="label text-xs">Min Quality</label>
        <select
          className="input text-sm"
          value={filters.min_gfi_quality ?? ''}
          onChange={(e) =>
            onChange({
              ...filters,
              min_gfi_quality: e.target.value ? Number(e.target.value) : undefined,
            })
          }
          disabled={loading}
        >
          <option value="">Any</option>
          <option value="0.4">40%+</option>
          <option value="0.6">60%+</option>
          <option value="0.8">80%+</option>
        </select>
      </div>

      {/* Mentored toggle */}
      <div className="flex items-center gap-2 pb-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={!!filters.mentored}
          onClick={() => onChange({ ...filters, mentored: !filters.mentored || undefined })}
          disabled={loading}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            filters.mentored ? 'bg-indigo-500' : 'bg-slate-200'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              filters.mentored ? 'translate-x-4' : 'translate-x-1'
            }`}
          />
        </button>
        <span className="text-xs font-medium text-slate-600">Mentored only</span>
      </div>
    </div>
  );
}

// ── Inner dashboard (needs useSearchParams) ───────────────────────────────────

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [userId, setUserId] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [cached, setCached] = useState(false);

  const [userLoading, setUserLoading] = useState(true);
  const [recsLoading, setRecsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [userError, setUserError] = useState('');
  const [recsError, setRecsError] = useState('');

  const [filters, setFilters] = useState<RecommendationFilters>({ limit: 20 });
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  // ── Resolve userId ───────────────────────────────────────────────────────────

  useEffect(() => {
    const fromParam = searchParams.get('userId');
    const fromStorage =
      typeof window !== 'undefined'
        ? localStorage.getItem('fosshack_user_id')
        : null;
    const resolved = fromParam || fromStorage;
    if (!resolved) {
      router.replace('/onboarding');
      return;
    }
    setUserId(resolved);
  }, [searchParams, router]);

  // ── Load user profile ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!userId) return;
    setUserLoading(true);
    setUserError('');
    getUser(userId)
      .then((u) => setUser(u))
      .catch((err) =>
        setUserError(err instanceof Error ? err.message : 'Failed to load profile'),
      )
      .finally(() => setUserLoading(false));
  }, [userId]);

  // ── Load recommendations ─────────────────────────────────────────────────────

  const fetchRecs = useCallback(
    async (currentFilters: RecommendationFilters, append = false) => {
      if (!userId) return;
      if (append) setLoadingMore(true);
      else setRecsLoading(true);
      setRecsError('');

      try {
        const data = await getRecommendations(userId, currentFilters);
        setRecommendations((prev) =>
          append ? [...prev, ...data.recommendations] : data.recommendations,
        );
        setTotalCandidates(data.totalCandidates);
        setCached(data.cached);
      } catch (err) {
        setRecsError(
          err instanceof Error ? err.message : 'Failed to load recommendations',
        );
      } finally {
        setRecsLoading(false);
        setLoadingMore(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    setPage(1);
    setRecommendations([]);
    fetchRecs({ ...filters, limit: LIMIT });
  }, [filters, fetchRecs]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchRecs({ ...filters, limit: LIMIT }, true);
  };

  const handleFilterChange = (newFilters: RecommendationFilters) => {
    setFilters(newFilters);
  };

  const hasMore = recommendations.length < totalCandidates;

  // ── Render ────────────────────────────────────────────────────────────────────

  if (!userId) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Your Recommendations</h1>
        <p className="text-sm text-slate-500 mt-1">
          Issues matched to your profile
          {totalCandidates > 0 && ` — ${totalCandidates} candidates analyzed`}
          {cached && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
              cached
            </span>
          )}
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        {userLoading ? (
          <div className="w-full lg:w-72 xl:w-80 flex-shrink-0">
            <ProfileSidebarSkeleton />
          </div>
        ) : userError ? (
          <div className="w-full lg:w-72 xl:w-80 flex-shrink-0">
            <div className="card text-sm text-rose-600 border-rose-200 bg-rose-50">
              {userError}
            </div>
          </div>
        ) : user ? (
          <ProfileSidebar user={user} />
        ) : null}

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <FilterBar
            filters={filters}
            onChange={handleFilterChange}
            loading={recsLoading}
          />

          {recsError && (
            <div className="card border-rose-200 bg-rose-50 text-sm text-rose-700 mb-4">
              {recsError}
            </div>
          )}

          {recsLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <IssueCardSkeleton key={i} />
              ))}
            </div>
          ) : recommendations.length === 0 ? (
            <div className="card flex flex-col items-center gap-3 py-16 text-center">
              <div className="text-4xl">🔍</div>
              <h3 className="text-base font-semibold text-slate-700">
                No recommendations found
              </h3>
              <p className="text-sm text-slate-500 max-w-sm">
                Try adjusting your filters, or update your profile with more details.
              </p>
              <a href="/onboarding" className="btn-primary mt-2">
                Update Profile
              </a>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {recommendations.map((rec) => (
                  <IssueCard
                    key={rec.issue.id}
                    recommendation={rec}
                    showMatchScore
                  />
                ))}
              </div>

              {/* Load more */}
              {hasMore && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="btn-secondary gap-2"
                  >
                    {loadingMore ? (
                      <>
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Loading…
                      </>
                    ) : (
                      `Load More (${totalCandidates - recommendations.length} remaining)`
                    )}
                  </button>
                </div>
              )}

              <p className="mt-4 text-center text-xs text-slate-400">
                Showing {recommendations.length} of {totalCandidates} matched issues
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page export with Suspense (required for useSearchParams) ──────────────────

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="mb-8">
            <div className="skeleton h-8 w-64 mb-2" />
            <div className="skeleton h-4 w-48" />
          </div>
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="w-full lg:w-72 flex-shrink-0">
              <ProfileSidebarSkeleton />
            </div>
            <div className="flex-1 space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <IssueCardSkeleton key={i} />
              ))}
            </div>
          </div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
