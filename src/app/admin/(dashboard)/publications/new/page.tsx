import Link from 'next/link';

import {
  Card,
  PageHeader,
  secondaryButtonClass,
} from '../../../_components/ui';
import { createPublicationAction } from '../actions';
import { PublicationForm } from '../publication-form';

export const metadata = { title: 'New Publication — Admin' };

export default function NewPublicationPage() {
  return (
    <>
      <PageHeader
        title="New Publication"
        description="A Publication is an independent editorial brand with its own domain, locale, and Story selection."
        action={
          <Link href="/admin/publications" className={secondaryButtonClass}>
            Back
          </Link>
        }
      />
      <Card>
        <PublicationForm action={createPublicationAction} mode="create" />
      </Card>
    </>
  );
}
