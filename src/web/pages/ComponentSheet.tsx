import { useState } from 'react';
import { ApiFailure } from '../api';
import {
  Badge,
  Button,
  Choice,
  CountTile,
  EmptyState,
  Field,
  FilterTabs,
  Icon,
  LoadError,
  Loading,
  Menu,
  Notice,
  PageHeader,
  Progress,
  SearchField,
  Section,
  Segmented,
  Sheet,
  SkeletonRows,
  SkeletonTiles,
  Stepper,
  useConfirm,
  useToast,
} from '../ui';

/** Development only (/_components): every shared component in its states, for design review. */
export function ComponentSheet() {
  const toast = useToast();
  const confirm = useConfirm();
  const [seg, setSeg] = useState<'in' | 'out'>('in');
  const [tab, setTab] = useState<'sat' | 'sun'>('sat');
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState(false);
  const [pressed, setPressed] = useState<string | null>('never');
  return (
    <>
      <PageHeader
        title="Components"
        summary="Every shared component and state"
        primary={<Button kind="primary">Primary action</Button>}
        menu={[{ label: 'An option', onSelect: () => toast('Chosen') }, { label: 'Delete thing…', danger: true, onSelect: () => undefined }]}
      />
      <div className="sections">
        <Section title="Buttons" id="c-buttons">
          <div className="btn-row">
            <Button kind="primary">Save changes</Button>
            <Button>Cancel</Button>
            <Button kind="danger">Delete activity</Button>
            <Button kind="ghost">Edit</Button>
            <Button kind="primary" busy busyLabel="Saving…">
              Save
            </Button>
            <Button disabled>Disabled</Button>
            <Button small>Arrived</Button>
            <Menu label="More actions" items={[{ label: 'Edit', onSelect: () => undefined }]} />
          </div>
        </Section>
        <Section title="Form" id="c-form">
          <div className="form">
            <div className="field-pair">
              <Field id="c-first" label="First name">
                <input className="input" defaultValue="Sam" />
              </Field>
              <Field id="c-last" label="Last name" error="Enter a last name">
                <input className="input" />
              </Field>
            </div>
            <Field id="c-pref" label="Goes by" optional hint="Shown on their lanyard.">
              <input className="input" />
            </Field>
            <Field id="c-sel" label="Section">
              <select className="select">
                <option>Cubs</option>
              </select>
            </Field>
            <Field id="c-notes" label="Notes" optional>
              <textarea className="textarea" />
            </Field>
            <fieldset className="choices">
              <legend className="field-label">What will you use?</legend>
              <Choice label="Gate" description="Arrivals and departures" defaultChecked />
              <Choice label="Meals" description="Count who has eaten" />
            </fieldset>
            <SearchField id="c-search" label="Find a person" value={q} onChange={setQ} />
          </div>
        </Section>
        <Section title="Status" id="c-status">
          <div className="btn-row">
            <Badge>Neutral</Badge>
            <Badge tone="success">On site</Badge>
            <Badge tone="warning">Not arrived</Badge>
            <Badge tone="error" icon>
              Allergy
            </Badge>
            <Badge tone="info">Demo</Badge>
            <Badge tone="brand">Scanning</Badge>
          </div>
          <Notice title="Information">
            <p>A note that helps.</p>
          </Notice>
          <Notice tone="success" title="All clear" />
          <Notice tone="warning">
            <p>3 scans to check.</p>
          </Notice>
          <LoadError error={new ApiFailure(0, 'offline', 'offline')} onRetry={() => undefined} what="people" />
        </Section>
        <Section title="Counts and controls" id="c-controls">
          <div className="tiles">
            <CountTile value={84} label="On site" tone="success" pressed={pressed === 'on'} onPress={() => setPressed('on')} />
            <CountTile value={4} label="Not arrived" tone="warning" pressed={pressed === 'never'} onPress={() => setPressed('never')} />
            <CountTile value={2} label="Left camp" pressed={pressed === 'off'} onPress={() => setPressed('off')} />
          </div>
          <Segmented label="Direction" value={seg} onChange={setSeg} options={[{ value: 'in', label: 'Arriving' }, { value: 'out', label: 'Leaving' }]} />
          <FilterTabs label="Day" value={tab} onChange={setTab} options={[{ value: 'sat', label: 'Sat 14 Dec' }, { value: 'sun', label: 'Sun 15 Dec' }]} />
          <Stepper steps={['Choose file', 'Match columns', 'Check', 'Done']} current={1} />
          <Progress value={42} max={90} />
        </Section>
        <Section title="Lists" id="c-lists">
          <ul className="list">
            <li className="row row-link">
              <span className="row-main">
                <span className="row-title">
                  <a href="#c-lists">Sam Lee</a>
                </span>
                <span className="row-meta">Cubs · Red Gum Cub Pack</span>
              </span>
              <Badge tone="success">On site</Badge>
              <span className="row-side">
                <Button small>Left</Button>
              </span>
            </li>
            <li>
              <button type="button" className="row row-button row-large">
                <span className="row-main">
                  <span className="row-title">Gate</span>
                  <span className="row-meta">Arrivals and departures</span>
                </span>
                <Icon name="chevron" />
              </button>
            </li>
          </ul>
          <EmptyState title="No activities yet" actions={<Button kind="primary">Add activity</Button>}>
            Add the first one.
          </EmptyState>
          <Loading what="people">
            <SkeletonTiles />
            <SkeletonRows rows={2} action />
          </Loading>
        </Section>
        <Section title="Overlays" id="c-overlays">
          <div className="btn-row">
            <Button onClick={() => toast('Activity added', { undo: () => undefined })}>Show toast</Button>
            <Button onClick={() => void confirm({ title: 'Delete Kayaking?', body: <p>This can't be undone.</p>, confirm: 'Delete activity', danger: true })}>
              Show confirm
            </Button>
            <Button onClick={() => setSheet(true)}>Show sheet</Button>
          </div>
          <Sheet open={sheet} title="Find by name" onClose={() => setSheet(false)}>
            <SearchField id="c-sheet-q" label="Name" value={q} onChange={setQ} />
          </Sheet>
        </Section>
      </div>
    </>
  );
}
