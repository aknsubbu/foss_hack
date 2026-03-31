import type { Issue, Recommendation } from '@/lib/types';
import DifficultyBadge from './DifficultyBadge';
import DomainBadge from './DomainBadge';

interface BaseProps {
  showMatchScore?: boolean;
}

interface IssueOnlyProps extends BaseProps {
  issue: Issue;
  recommendation?: never;
}

interface RecommendationProps extends BaseProps {
  recommendation: Recommendation;
  issue?: never;
}

type Props = IssueOnlyProps | RecommendationProps;

function StarIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

function MentorIcon() {
  return (
    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
      <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v1h8v-1zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-1a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v1h-3zM4.75 14.094A5.973 5.973 0 004 17v1H1v-1a3 3 0 013.75-2.906z" />
    </svg>
  );
}

function scoreColor(score: number): string {
  if (score >= 0.75) return 'bg-emerald-500';
  if (score >= 0.5) return 'bg-amber-400';
  return 'bg-rose-400';
}

function scoreTextColor(score: number): string {
  if (score >= 0.75) return 'text-emerald-700';
  if (score >= 0.5) return 'text-amber-700';
  return 'text-rose-600';
}

export default function IssueCard({ issue: issueProp, recommendation, showMatchScore }: Props) {
  const issue = issueProp ?? recommendation!.issue;
  const matchScore = recommendation?.matchScore;
  const matchReasons = recommendation?.matchReasons ?? [];
  const skillOverlap = recommendation?.skillOverlap ?? [];
  const shouldShowScore = showMatchScore ?? !!recommendation;

  const scorePercent =
    matchScore !== undefined ? Math.round(matchScore * 100) : null;

  return (
    <div className="card card-hover flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-mono text-slate-400 truncate max-w-[180px]">
              {issue.repoSlug}#{issue.number}
            </span>
            {issue.isGoodFirstIssue && (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 ring-1 ring-indigo-200">
                <StarIcon />
                GFI
              </span>
            )}
            {issue.hasMentor && (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700 ring-1 ring-teal-200">
                <MentorIcon />
                Mentored
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">
            {issue.title}
          </h3>
        </div>
        <DifficultyBadge difficulty={issue.difficulty} />
      </div>

      {/* Domains & languages */}
      <div className="flex flex-wrap gap-1.5">
        {issue.domain?.slice(0, 3).map((d) => (
          <DomainBadge key={d} domain={d} />
        ))}
        {issue.language?.slice(0, 3).map((lang) => (
          <span
            key={lang}
            className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
          >
            {lang}
          </span>
        ))}
      </div>

      {/* Match score bar */}
      {shouldShowScore && scorePercent !== null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-600">Match score</span>
            <span className={`font-bold ${scoreTextColor(matchScore!)}`}>
              {scorePercent}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${scoreColor(matchScore!)}`}
              style={{ width: `${scorePercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Match reasons */}
      {matchReasons.length > 0 && (
        <ul className="space-y-1">
          {matchReasons.slice(0, 3).map((reason, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
              <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
              {reason}
            </li>
          ))}
        </ul>
      )}

      {/* Skill overlap chips */}
      {skillOverlap.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skillOverlap.slice(0, 5).map((skill) => (
            <span
              key={skill}
              className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-200"
            >
              {skill}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100 mt-auto">
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {issue.gfiQualityScore !== undefined && (
            <span className="flex items-center gap-1">
              <span className="font-medium text-slate-600">Quality</span>
              <span
                className={`font-bold ${
                  issue.gfiQualityScore >= 0.7
                    ? 'text-emerald-600'
                    : issue.gfiQualityScore >= 0.4
                    ? 'text-amber-600'
                    : 'text-rose-500'
                }`}
              >
                {Math.round(issue.gfiQualityScore * 100)}%
              </span>
            </span>
          )}
          {issue.commentCount !== undefined && (
            <span>{issue.commentCount} comments</span>
          )}
          {issue.freshness && (
            <span className="capitalize text-slate-400">{issue.freshness}</span>
          )}
        </div>

        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary text-xs px-3 py-1.5 gap-1.5"
        >
          View Issue
          <ExternalLinkIcon />
        </a>
      </div>
    </div>
  );
}
