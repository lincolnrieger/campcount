import { createElement } from 'react';
import { api } from './api';
import type { useConfirm } from './ui';

type Confirm = ReturnType<typeof useConfirm>;

/**
 * Ask before deleting an activity or meal, saying how many scans go with it.
 * Resolves true once deleted, false if the person changed their mind.
 */
export async function deleteContext(confirm: Confirm, eventId: string, kind: 'activities' | 'meals', id: string, name: string): Promise<boolean> {
  const { scans } = await api<{ scans: number }>(`/events/${eventId}/${kind}/${id}/scan-count`).catch(() => ({ scans: -1 }));
  const records =
    scans > 0
      ? `This also deletes the ${scans} scan${scans === 1 ? '' : 's'} recorded for it. To keep them, cancel it instead. `
      : scans < 0
        ? 'Any scans recorded for it are deleted too. '
        : '';
  const ok = await confirm({
    title: `Delete ${name}?`,
    body: createElement('p', null, `${records}This can't be undone.`),
    confirm: kind === 'activities' ? 'Delete activity' : 'Delete meal',
    danger: true,
  });
  if (!ok) return false;
  await api(`/events/${eventId}/${kind}/${id}`, { method: 'DELETE' });
  return true;
}
