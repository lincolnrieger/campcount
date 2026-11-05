import { useState } from 'react';
import { Icon } from './Icon';

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

/** Which column a table is sorted by. Clicking the same column again reverses it. */
export function useSort<K extends string>(key: K, dir: SortDir = 'asc') {
  const [sort, setSort] = useState<SortState<K>>({ key, dir });
  const toggle = (k: K) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }));
  return { sort, toggle };
}

const collator = new Intl.Collator('en-AU', { numeric: true, sensitivity: 'base' });

/** Sort rows by a column value; empty values always go last. */
export function sortRows<T>(rows: T[], get: (row: T) => string | number | null | undefined, dir: SortDir): T[] {
  const factor = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x === y) return 0;
    if (x === null || x === undefined || x === '') return 1;
    if (y === null || y === undefined || y === '') return -1;
    return factor * (typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y)));
  });
}

/** A sortable column header: a button inside the th, with aria-sort on the active column. */
export function SortHeader<K extends string>({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: K;
  sort: SortState<K>;
  onSort: (k: K) => void;
  className?: string;
}) {
  const active = sort.key === column;
  return (
    <th scope="col" className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="sort-button" onClick={() => onSort(column)}>
        {label}
        <Icon name={active ? (sort.dir === 'asc' ? 'sortAsc' : 'sortDesc') : 'sort'} size={14} />
      </button>
    </th>
  );
}
