import { TopicRepository } from '@/domain';

import {
  Badge,
  Card,
  PageHeader,
  secondaryButtonClass,
} from '../../_components/ui';
import { DatabaseUnavailable, EmptyState } from '../../_components/notices';
import { getDb, isDatabaseConfigured } from '../../_lib/db';
import { setTopicEnabledAction } from './actions';
import { CreateTopicForm } from './topic-form';

export default async function TopicsPage() {
  if (!isDatabaseConfigured()) {
    return (
      <>
        <PageHeader title="Topics" />
        <DatabaseUnavailable />
      </>
    );
  }

  const topics = await new TopicRepository(getDb()).listAll();
  const parents = topics.filter((topic) => topic.parent_id === null);
  const parentName = new Map(parents.map((parent) => [parent.id, parent.name]));

  return (
    <>
      <PageHeader
        title="Topics"
        description="Controlled taxonomy. Top-level Topics are fixed; sub-Topics may be added."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={`All Topics (${topics.length})`}>
            {topics.length === 0 ? (
              <EmptyState message="No Topics seeded." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-neutral-500">
                    <tr className="border-b border-neutral-200 dark:border-neutral-800">
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3">Parent</th>
                      <th className="py-2 pr-3">Enabled</th>
                      <th className="py-2 pr-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {topics.map((topic) => (
                      <tr key={topic.id}>
                        <td className="py-2 pr-3">
                          <span className="font-medium">{topic.name}</span>
                          <div className="text-xs text-neutral-500">
                            {topic.slug}
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-neutral-500">
                          {topic.parent_id
                            ? (parentName.get(topic.parent_id) ?? '—')
                            : '— top level —'}
                        </td>
                        <td className="py-2 pr-3">
                          {topic.enabled ? (
                            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                              Enabled
                            </Badge>
                          ) : (
                            <Badge>Disabled</Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <form action={setTopicEnabledAction}>
                            <input type="hidden" name="id" value={topic.id} />
                            <input
                              type="hidden"
                              name="enabled"
                              value={topic.enabled ? 'false' : 'true'}
                            />
                            <button
                              type="submit"
                              className={secondaryButtonClass}
                            >
                              {topic.enabled ? 'Disable' : 'Enable'}
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <Card title="Add sub-Topic">
          <CreateTopicForm
            parents={parents.map((parent) => ({
              id: parent.id,
              name: parent.name,
            }))}
          />
        </Card>
      </div>
    </>
  );
}
