import { TopicRepository } from '@/domain';

import { Card, PageHeader } from '../../../_components/ui';
import { DatabaseUnavailable } from '../../../_components/notices';
import { getDb, isDatabaseConfigured } from '../../../_lib/db';
import { createSourceAction } from '../actions';
import { SourceForm } from '../source-form';

export default async function NewSourcePage() {
  if (!isDatabaseConfigured()) {
    return (
      <>
        <PageHeader title="New Source" />
        <DatabaseUnavailable />
      </>
    );
  }

  const topics = await new TopicRepository(getDb()).listAll();

  return (
    <>
      <PageHeader
        title="New Source"
        description="Register a publisher or feed."
      />
      <Card>
        <SourceForm
          action={createSourceAction}
          mode="create"
          topics={topics.map((topic) => ({ id: topic.id, name: topic.name }))}
          submitLabel="Create Source"
        />
      </Card>
    </>
  );
}
