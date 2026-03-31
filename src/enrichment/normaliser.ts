import type { RawIssue, IssueDoc } from '../types/issue';

// Converts a RawIssue into the base IssueDoc (no enrichment fields set yet).
// All enrichment modules operate on IssueDoc and return partial updates.
export function normalise(raw: RawIssue): IssueDoc {
  return {
    ...raw,
    id: '', // assigned by DB after upsert
    techStack: [],
    issueType: [],
    sourceList: [],
    isMentored: false,
  };
}
