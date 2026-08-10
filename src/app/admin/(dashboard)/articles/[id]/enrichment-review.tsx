import type { ArticleEnrichmentReview } from '@/admin/services/enrichment-service';
import type {
  ArticleEnrichmentRow,
  SuggestedEntity,
  SuggestedTopic,
} from '@/domain/types';

import { Badge, Card, formatTimestamp } from '../../../_components/ui';
import { EmptyState } from '../../../_components/notices';

/**
 * Read-only AI enrichment review for the Article detail page (Stage 6).
 *
 * Presents the latest enrichment plus prior versions, the advisory relevance,
 * summary, why-it-matters, provider/model/version, confidence, and any
 * validation/provider errors. Topic/Entity suggestions are shown split into
 * canonical matches and unresolved candidates — the unresolved ones are clearly
 * NOT canonical and require review before anything is created. All AI text is
 * untrusted and rendered as escaped text by React.
 */
export function EnrichmentReview({
  review,
}: {
  readonly review: ArticleEnrichmentReview;
}) {
  const { latest, history, suggestions } = review;

  if (!latest) {
    return (
      <Card title="AI enrichment">
        <EmptyState message="No enrichment yet. Run AI enrichment to generate advisory analysis." />
        <p className="mt-2 text-xs text-neutral-500">
          AI output is advisory and is never published automatically.
        </p>
      </Card>
    );
  }

  return (
    <Card title="AI enrichment (advisory)">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={latest.status} />
          {latest.relevance ? (
            <RelevanceBadge relevance={latest.relevance} />
          ) : null}
          <Badge>v{latest.enrichment_version}</Badge>
          <span className="text-xs text-neutral-500">
            {latest.model_provider} · {latest.model_name} ·{' '}
            {formatTimestamp(latest.generated_at)}
          </span>
        </div>

        {latest.status === 'PROVIDER_ERROR' ? (
          <Notice tone="error">
            Provider error{latest.error_code ? ` (${latest.error_code})` : ''}:{' '}
            {latest.error_message ?? 'unknown error'}. The source Article is
            unchanged; you can retry.
          </Notice>
        ) : null}

        {latest.status === 'INVALID_OUTPUT' ? (
          <Notice tone="error">
            Output failed validation: {latest.validation_error ?? 'unknown'}.
            Recorded for audit; not trusted.
          </Notice>
        ) : null}

        {latest.status === 'SUCCEEDED' ? (
          <>
            {latest.relevance_reason ? (
              <Field label="Relevance reason" value={latest.relevance_reason} />
            ) : null}
            {latest.summary ? (
              <Field label="Summary" value={latest.summary} />
            ) : null}
            {latest.why_it_matters ? (
              <Field label="Why it matters" value={latest.why_it_matters} />
            ) : null}
            <div className="text-xs text-neutral-500">
              Confidence:{' '}
              {latest.confidence == null ? '—' : latest.confidence.toFixed(2)} ·
              schema {latest.schema_version ?? '—'} · prompt{' '}
              {latest.prompt_version ?? '—'}
            </div>

            <SuggestionSection review={review} suggestions={suggestions} />
          </>
        ) : null}

        {history.length > 1 ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Version history ({history.length})
            </summary>
            <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
              {history.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-2 py-1.5 text-xs"
                >
                  <Badge>v{row.enrichment_version}</Badge>
                  <StatusBadge status={row.status} />
                  <span className="text-neutral-500">
                    {row.relevance ?? '—'} · {row.model_name} ·{' '}
                    {formatTimestamp(row.generated_at)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Card>
  );
}

function SuggestionSection({
  suggestions,
}: {
  readonly review: ArticleEnrichmentReview;
  readonly suggestions: ArticleEnrichmentReview['suggestions'];
}) {
  if (!suggestions) return null;
  const {
    matchedTopics,
    unresolvedTopics,
    matchedEntities,
    unresolvedEntities,
  } = suggestions;

  return (
    <div className="space-y-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <div>
        <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
          Suggested Topics
        </p>
        <p className="mb-1 text-[11px] text-neutral-500">
          Matches are existing canonical Topics; candidates are NOT canonical
          and require review.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {matchedTopics.map(({ topic, suggestion }) => (
            <Badge
              key={topic.id}
              className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
            >
              {topic.name} · match{confidenceSuffix(suggestion.confidence)}
            </Badge>
          ))}
          {unresolvedTopics.map((t, i) => (
            <TopicCandidate key={`ut-${i}`} topic={t} />
          ))}
          {matchedTopics.length + unresolvedTopics.length === 0 ? (
            <span className="text-xs text-neutral-500">None suggested.</span>
          ) : null}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
          Suggested Entities
        </p>
        <p className="mb-1 text-[11px] text-neutral-500">
          Matches resolve to existing Entities; candidates are NOT canonical and
          require review.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {matchedEntities.map(({ entity, suggestion }) => (
            <Badge
              key={entity.id}
              className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
            >
              {entity.name} · match{confidenceSuffix(suggestion.confidence)}
            </Badge>
          ))}
          {unresolvedEntities.map((e, i) => (
            <EntityCandidate key={`ue-${i}`} entity={e} />
          ))}
          {matchedEntities.length + unresolvedEntities.length === 0 ? (
            <span className="text-xs text-neutral-500">None suggested.</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* Untrusted candidate names render as escaped React text. */
function TopicCandidate({ topic }: { readonly topic: SuggestedTopic }) {
  return (
    <Badge className="border border-dashed border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      {topic.name} · candidate{confidenceSuffix(topic.confidence)}
    </Badge>
  );
}

function EntityCandidate({ entity }: { readonly entity: SuggestedEntity }) {
  return (
    <Badge className="border border-dashed border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      {entity.name}
      {entity.entity_type ? ` (${entity.entity_type})` : ''} · candidate
      {confidenceSuffix(entity.confidence)}
    </Badge>
  );
}

function confidenceSuffix(confidence: number | null): string {
  return confidence == null ? '' : ` ${confidence.toFixed(2)}`;
}

function Field({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
        {label}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap text-neutral-800 dark:text-neutral-200">
        {value}
      </p>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  readonly tone: 'error';
  readonly children: React.ReactNode;
}) {
  void tone;
  return (
    <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
      {children}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  readonly status: ArticleEnrichmentRow['status'];
}) {
  const className =
    status === 'SUCCEEDED'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
      : 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300';
  return <Badge className={className}>{status}</Badge>;
}

function RelevanceBadge({
  relevance,
}: {
  readonly relevance: NonNullable<ArticleEnrichmentRow['relevance']>;
}) {
  const className =
    relevance === 'RELEVANT'
      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
      : relevance === 'MAYBE_RELEVANT'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
        : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
  return <Badge className={className}>{relevance}</Badge>;
}
