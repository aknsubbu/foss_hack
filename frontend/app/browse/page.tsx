'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { browseIssues, searchIssues } from '@/lib/api';
import type {
  BrowseFilters,
  Difficulty,
  Freshness,
  Issue,
  IssueType,
  SearchHit,
} from '@/lib/types';
import IssueCard from '@/components/IssueCard';
import { IssueCardSkeleton } from '@/components/LoadingSkeleton';

// ── Convert SearchHit → Issue (for unified rendering) ─────────────────────────

function hitToIssue(hit: SearchHit): Issue {
  return {
    id: hit.id,
    number: hit.number,
    title: hit.title,
    url: hit.url,
    repoSlug: hit.repoSlug,
    labels: hit.labels ?? [],
    difficulty: hit.difficulty,
    type: hit.type,
    domain: hit.domain ?? [],
    language: hit.language ?? [],
    isGoodFirstIssue: hit.isGoodFirstIssue,
    gfiQualityScore: hit.gfiQualityScore,
    hasMentor: hit.hasMentor,
    freshness: hit.freshness,
  };
}

// ── Filter sidebar ─────────────────────────────────────────────────────────────

interface FilterSidebarProps {
  filters: BrowseFilters;
  onChange: (f: BrowseFilters) => void;
  loading: boolean;
}

function FilterSidebar({ filters, onChange, loading }: FilterSidebarProps) {
  return (
    <aside className="w-full lg:w-60 xl:w-64 flex-shrink-0">
      <div className="card sticky top-20 space-y-5">
        <h3 className="text-sm font-semibold text-slate-700">Filters</h3>

        {/* Language */}
        <div>
          <label className="label text-xs">Language</label>
          <input
            type="text"
            className="input text-sm"
            placeholder="e.g. TypeScript"
            value={filters.lang ?? ''}
            onChange={(e) => onChange({ ...filters, lang: e.target.value || undefined, page: 1 })}
            disabled={loading}
          />
        </div>

        {/* Difficulty */}
        <div>
          <label className="label text-xs">Difficulty</label>
          <select
            className="input text-sm"
            value={filters.difficulty ?? ''}
            onChange={(e) =>
              onChange({ ...filters, difficulty: (e.target.value as Difficulty) || undefined, page: 1 })
            }
            disabled={loading}
          >
            <option value="">Any</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>

        {/* Issue type */}
        <div>
          <label className="label text-xs">Type</label>
          <select
            className="input text-sm"
            value={filters.type ?? ''}
            onChange={(e) =>
              onChange({ ...filters, type: (e.target.value as IssueType) || undefined, page: 1 })
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

        {/* Freshness */}
        <div>
          <label className="label text-xs">Freshness</label>
          <select
            className="input text-sm"
            value={filters.freshness ?? ''}
            onChange={(e) =>
              onChange({ ...filters, freshness: (e.target.value as Freshness) || undefined, page: 1 })
            }
            disabled={loading}
          >
            <option value="">Any</option>
            <option value="fresh">Fresh (&lt; 7 days)</option>
            <option value="recent">Recent (&lt; 30 days)</option>
          </select>
        </div>

        {/* Mentored */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={!!filters.mentored}
            onClick={() =>
              onChange({ ...filters, mentored: filters.mentored ? undefined : true, page: 1 })
            }
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

        {/* Reset */}
        <button
          type="button"
          onClick={() => onChange({ page: 1, limit: 20 })}
          className="btn-ghost w-full text-xs text-slate-400"
          disabled={loading}
        >
          Reset Filters
        </button>
      </div>
    </aside>
  );
}

// ── Pagination ─────────────────────────────────────────────────────────────────

interface PaginationProps {
  page: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
  loading: boolean;
}

function Pagination({ page, total, limit, onChange, loading }: PaginationProps) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;

  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  return (
    <div className="mt-8 flex items-center justify-center gap-1 flex-wrap">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1 || loading}
        className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
      >
        ← Prev
      </button>

      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`ellipsis-${i}`} className="px-2 text-slate-400 text-sm">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p as number)}
            disabled={loading}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              p === page
                ? 'bg-indigo-500 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages || loading}
        className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );
}

// ── Main browse content ───────────────────────────────────────────────────────

function BrowseContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isSearchMode, setIsSearchMode] = useState(false);

  // Browse state
  const [filters, setFilters] = useState<BrowseFilters>({ page: 1, limit: 20 });
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');

  // Search state
  const [searchResults, setSearchResults] = useState<Issue[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  // ── Debounce search query ─────────────────────────────────────────────────

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // ── Toggle search/browse mode ─────────────────────────────────────────────

  useEffect(() => {
    setIsSearchMode(debouncedQuery.trim().length > 0);
  }, [debouncedQuery]);

  // ── Fetch browse issues ───────────────────────────────────────────────────

  const fetchBrowse = useCallback(async (f: BrowseFilters) => {
    setBrowseLoading(true);
    setBrowseError('');
    try {
      const data = await browseIssues(f);
      setIssues(data.data);
      setTotal(data.total);
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Failed to load issues');
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSearchMode) {
      fetchBrowse(filters);
    }
  }, [filters, isSearchMode, fetchBrowse]);

  // ── Fetch search results ──────────────────────────────────────────────────

  useEffect(() => {
    if (!isSearchMode) return;
    setSearchLoading(true);
    setSearchError('');
    searchIssues(debouncedQuery)
      .then((data) => {
        setSearchResults(data.hits.map(hitToIssue));
        setSearchTotal(data.estimatedTotalHits);
      })
      .catch((err) => {
        setSearchError(err instanceof Error ? err.message : 'Search failed');
      })
      .finally(() => setSearchLoading(false));
  }, [debouncedQuery, isSearchMode]);

  const handleFilterChange = (newFilters: BrowseFilters) => {
    setFilters(newFilters);
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const displayIssues = isSearchMode ? searchResults : issues;
  const displayTotal = isSearchMode ? searchTotal : total;
  const isLoading = isSearchMode ? searchLoading : browseLoading;
  const error = isSearchMode ? searchError : browseError;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Browse Issues</h1>
        <p className="text-sm text-slate-500">
          Explore open source issues. Use the search and filters to narrow down.
        </p>
      </div>

      {/* Search bar */}
      <div className="mb-6">
        <div className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            className="input pl-12 py-3 text-base shadow-sm"
            placeholder="Search issues by title, repo, or keyword…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => { setSearchQuery(''); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {isSearchMode && !isLoading && (
          <p className="text-xs text-slate-500 mt-2">
            ~{displayTotal.toLocaleString()} results for &ldquo;{debouncedQuery}&rdquo;
          </p>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar — hidden during search */}
        {!isSearchMode && (
          <FilterSidebar
            filters={filters}
            onChange={handleFilterChange}
            loading={browseLoading}
          />
        )}

        {/* Results */}
        <div className="flex-1 min-w-0">
          {/* Stats bar */}
          {!isLoading && !error && displayIssues.length > 0 && (
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-slate-500">
                {isSearchMode
                  ? `Showing ${displayIssues.length} search results`
                  : `${displayTotal.toLocaleString()} issues · page ${filters.page ?? 1} of ${Math.ceil(displayTotal / (filters.limit ?? 20))}`}
              </p>
            </div>
          )}

          {error && (
            <div className="card border-rose-200 bg-rose-50 text-sm text-rose-700 mb-4">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <IssueCardSkeleton key={i} />
              ))}
            </div>
          ) : displayIssues.length === 0 ? (
            <div className="card flex flex-col items-center gap-3 py-16 text-center">
              <div className="text-4xl">🔍</div>
              <h3 className="text-base font-semibold text-slate-700">No issues found</h3>
              <p className="text-sm text-slate-500 max-w-sm">
                Try adjusting your search query or filters.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {displayIssues.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} showMatchScore={false} />
                ))}
              </div>

              {!isSearchMode && (
                <Pagination
                  page={filters.page ?? 1}
                  total={displayTotal}
                  limit={filters.limit ?? 20}
                  onChange={handlePageChange}
                  loading={browseLoading}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page export ───────────────────────────────────────────────────────────────

export default function BrowsePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-8 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <IssueCardSkeleton key={i} />
          ))}
        </div>
      }
    >
      <BrowseContent />
    </Suspense>
  );
}
