import Link from 'next/link';

import { ArticleRepository, SourceRepository } from '@/domain';
import { ARTICLE_STATUSES, articleStatusSchema } from '@/domain/enums';
import type { ArticleFilter } from '@/domain';

import {
  AdminLink,
  Badge,
  buttonClass,
  Card,
  formatTimestamp,
  inputClass,
  labelClass,
  PageHeader,
  secondaryButtonClass,
} from '../../_components/ui';
import { DatabaseUnavailable, EmptyState } from '../../_components/notices';
import { getDb, isDatabaseConfigured } from '../../_lib/db';

const PAGE_SIZE = 25;

export default async function ArticlesPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    source?: string;
    status?: string;
    q?: string;
    page?: string;
  }>;
}) {
  if (!isDatabaseConfigured()) {
    return (
      <>
        <PageHeader title="Articles" />
        <DatabaseUnavailable />
      </>
    );
  }

  const sp = await searchParams;
  const db = getDb();

  const statusParsed = articleStatusSchema.safeParse(sp.status);
  const status = statusParsed.success ? statusParsed.data : undefined;
  const sourceId = sp.source && sp.source.length > 0 ? sp.source : undefined;
  const search = sp.q && sp.q.trim().length > 0 ? sp.q.trim() : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  const filter: ArticleFilter = {
    sourceId,
    status,
    search,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const articles = new ArticleRepository(db);
  const [rows, total, sources] = await Promise.all([
    articles.search(filter),
    articles.count(filter),
    new SourceRepository(db).listAll(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Articles" description={`${total} matching`} />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="q" className={labelClass}>
              Search
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={search ?? ''}
              placeholder="Title or excerpt"
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <label htmlFor="source" className={labelClass}>
              Source
            </label>
            <select
              id="source"
              name="source"
              defaultValue={sourceId ?? ''}
              className={`mt-1 ${inputClass}`}
            >
              <option value="">All</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="status" className={labelClass}>
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={status ?? ''}
              className={`mt-1 ${inputClass}`}
            >
              <option value="">All</option>
              {ARTICLE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClass}>
            Apply
          </button>
          <Link href="/admin/articles" className={secondaryButtonClass}>
            Reset
          </Link>
        </form>
      </Card>

      <div className="mt-4">
        <Card>
          {rows.length === 0 ? (
            <EmptyState message="No Articles match these filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-neutral-500">
                  <tr className="border-b border-neutral-200 dark:border-neutral-800">
                    <th className="py-2 pr-3">Title</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Published</th>
                    <th className="py-2 pr-3">Discovered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {rows.map((article) => (
                    <tr key={article.id}>
                      <td className="py-2 pr-3">
                        <AdminLink href={`/admin/articles/${article.id}`}>
                          {article.original_title}
                        </AdminLink>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge>{article.status}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-neutral-500">
                        {formatTimestamp(article.published_at)}
                      </td>
                      <td className="py-2 pr-3 text-neutral-500">
                        {formatTimestamp(article.discovered_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <PageLink
            label="Previous"
            page={page - 1}
            disabled={page <= 1}
            sp={sp}
          />
          <span className="text-neutral-500">
            Page {page} of {totalPages}
          </span>
          <PageLink
            label="Next"
            page={page + 1}
            disabled={page >= totalPages}
            sp={sp}
          />
        </div>
      ) : null}
    </>
  );
}

function PageLink({
  label,
  page,
  disabled,
  sp,
}: {
  readonly label: string;
  readonly page: number;
  readonly disabled: boolean;
  readonly sp: { source?: string; status?: string; q?: string };
}) {
  if (disabled) {
    return <span className="text-neutral-400">{label}</span>;
  }
  const params = new URLSearchParams();
  if (sp.q) params.set('q', sp.q);
  if (sp.source) params.set('source', sp.source);
  if (sp.status) params.set('status', sp.status);
  params.set('page', String(page));
  return (
    <Link
      href={`/admin/articles?${params.toString()}`}
      className="font-medium text-sky-700 hover:underline dark:text-sky-400"
    >
      {label}
    </Link>
  );
}
