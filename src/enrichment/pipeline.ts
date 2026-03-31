import type { RawIssue, IssueDoc } from '../types/issue';
import { normalise } from './normaliser';
import { runDifficultyClassifier } from './difficulty';
import { runIssueTypeClassifier } from './issue-type';
import { runTechStackTagger } from './tech-stack';
import { runSemanticTagger } from './semantic-tagger';
import { runRepoHealthScorer } from './repo-health';
import { runFreshnessTracker } from './freshness';
import { runMentorshipSignal } from './mentorship';
import { runEmbeddingGenerator } from './embeddings';
import { logger } from '../api/logger';

// Each module receives the current IssueDoc and returns a partial update.
// Modules must NEVER throw — failures are logged as warnings.
// The raw issue is always stored even if all enrichment fails.
// Order matters: semantic-tagger runs after tech-stack (needs techStack context).

type EnrichmentModule = (doc: IssueDoc) => Promise<Partial<IssueDoc>>;

const MODULES: EnrichmentModule[] = [
  runDifficultyClassifier,
  runIssueTypeClassifier,
  runTechStackTagger,
  runSemanticTagger,       // NEW: after tech-stack, uses techStack as context
  runRepoHealthScorer,
  runFreshnessTracker,
  runMentorshipSignal,
  runEmbeddingGenerator,
];

export async function enrichIssue(raw: RawIssue): Promise<IssueDoc> {
  const doc: IssueDoc = normalise(raw);

  for (const mod of MODULES) {
    try {
      const patch = await mod(doc);
      Object.assign(doc, patch);
    } catch (err) {
      logger.warn(
        { err, module: mod.name, url: doc.url },
        'Enrichment module failed — continuing',
      );
    }
  }

  doc.enrichedAt = new Date();

  logger.info(
    {
      url: doc.url,
      difficultyLabel: doc.difficultyLabel,
      issueType: doc.issueType,
      techStack: doc.techStack,
      module: 'pipeline',
    },
    'Enrichment completed',
  );

  return doc;
}

// Re-enrichment from stored raw_json — no API re-fetch needed
export async function reEnrichFromRaw(
  storedDoc: IssueDoc,
): Promise<IssueDoc> {
  const raw: RawIssue = {
    url: storedDoc.url,
    externalId: storedDoc.externalId,
    title: storedDoc.title,
    bodyRaw: storedDoc.bodyRaw,
    source: storedDoc.source,
    repoSlug: storedDoc.repoSlug,
    labels: storedDoc.labels,
    state: storedDoc.state,
    createdAt: storedDoc.createdAt,
    updatedAt: storedDoc.updatedAt,
    closedAt: storedDoc.closedAt,
    author: storedDoc.author,
    commentsCount: storedDoc.commentsCount,
    rawJson: storedDoc.rawJson,
  };
  return enrichIssue(raw);
}
