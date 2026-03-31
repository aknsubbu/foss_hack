import type { IssueDoc } from '../types/issue';

const MENTORED_LABELS = [
  'mentored',
  'has-mentor',
  'office-hours',
  'pair-programming',
  'pairing',
];

const MENTOR_KEYWORDS = [
  'happy to help',
  'feel free to ask',
  'reach out',
  'guidance available',
  'mentor',
  'office hours',
  'pair program',
  'will guide',
  'happy to guide',
  'can help you',
  'walk you through',
];

// Pure signal detection — no API calls needed.
export async function runMentorshipSignal(
  issue: IssueDoc,
): Promise<Partial<IssueDoc>> {
  const labelsLower = issue.labels.map((l) => l.toLowerCase());
  const bodyLower = issue.bodyRaw.toLowerCase();

  const fromLabel = labelsLower.some((l) =>
    MENTORED_LABELS.some((ml) => l.includes(ml)),
  );

  const fromBody = MENTOR_KEYWORDS.some((kw) => bodyLower.includes(kw));

  return { isMentored: fromLabel || fromBody };
}
