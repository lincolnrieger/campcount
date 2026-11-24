import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiFailure, api } from '../api';
import { accessibleBrand, contrast, DEFAULT_BRAND, subdomainProblem, suggestSubdomain } from '../../shared/site';
import { matchesSearch } from '../../shared/search';
import { useSession } from '../session';
import { eventSiteUrl, useSite } from '../site';
import type { EventSummary } from '../types';
import { useApi } from '../useApi';
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  EmptyState,
  ErrorSummary,
  Field,
  FilterChips,
  Icon,
  InfoTip,
  LoadError,
  Loading,
  PageHeader,
  SearchField,
  SkeletonHeader,
  SkeletonRows,
  SortHeader,
  Toolbar,
  formatDateRange,
  plural,
  sortRows,
  useConfirm,
  useRemembered,
  useSort,
  useToast,
  useWide,
} from '../ui';
import { FeatureChecklist } from './Events';
import type { EventFeatures } from '../../shared/schemas';

const STATUS: Record<string, { label: string; tone: 'neutral' | 'warning' | 'success' }> = {
  draft: { label: 'Not open yet', tone: 'warning' },
  open: { label: 'Open', tone: 'success' },
  completed: { label: 'Closed', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** The camp's logo, or a block of its colour with its first letter. */
export function CampMark({ event, size = 40 }: { event: Pick<EventSummary, 'name' | 'logoUrl' | 'brandColor'>; size?: number }) {
  if (event.logoUrl) return <img className="camp-mark" src={event.logoUrl} alt="" width={size} height={size} />;
  return (
    <span className="camp-mark camp-mark-letter" style={{ width: size, height: size, background: accessibleBrand(event.brandColor) }} aria-hidden="true">
      {event.name.trim()[0]?.toUpperCase() ?? 'C'}
    </span>
  );
}

/** "summercamp.campcount.com", as text. */
function addressText(rootDomain: string | null, subdomain: string | null) {
  return subdomain ? `${subdomain}.${rootDomain ?? 'campcount.com'}` : null;
}

type CampFilter = 'all' | 'current' | 'past' | 'demo';
const isCurrent = (e: EventSummary) => e.status === 'open' || e.status === 'draft';

/**
 * The admin console's home: every camp, each with its own address and
 * branding. Day-to-day work happens on each camp's own site.
 */
export function Camps() {
  const { me } = useSession();
  const site = useSite();
  const wide = useWide();
  const { data, error, loading, reload } = useApi<{ events: EventSummary[] }>('/events');
  const canCreate = me?.kind === 'user' && me.platformPermissions.includes('platform.events.create');
  const [q, setQ] = useRemembered('camps:q', '');
  const [filter, setFilter] = useRemembered<CampFilter>('camps:filter', 'all');
  const { sort, toggle } = useSort<'name' | 'dates' | 'status'>('dates');

  if (loading && !data)
    return (
      <Loading what="camps">
        <SkeletonHeader />
        <SkeletonRows rows={4} />
      </Loading>
    );
  if (error) return <LoadError error={error} onRetry={reload} what="camps" />;
  const events = data?.events ?? [];
  const address = (e: EventSummary) => addressText(site.rootDomain, e.subdomain);
  const counts: Record<CampFilter, number> = {
    all: events.length,
    current: events.filter(isCurrent).length,
    past: events.filter((e) => !isCurrent(e)).length,
    demo: events.filter((e) => e.isDemo).length,
  };
  const shown = sortRows(
    events.filter(
      (e) =>
        matchesSearch(q, e.name, e.location, e.subdomain ?? '') &&
        (filter === 'all' || (filter === 'current' && isCurrent(e)) || (filter === 'past' && !isCurrent(e)) || (filter === 'demo' && e.isDemo)),
    ),
    (e) => (sort.key === 'name' ? e.name : sort.key === 'status' ? STATUS[e.status]!.label : e.startsOn),
    sort.dir,
  );
  const groups = [
    { title: 'Current and upcoming', list: shown.filter(isCurrent) },
    { title: 'Past', list: shown.filter((e) => !isCurrent(e)) },
  ].filter((g) => g.list.length > 0);
  const filtered = q !== '' || filter !== 'all';
  const clear = () => {
    setQ('');
    setFilter('all');
  };

  const openSite = (e: EventSummary) => {
    const url = eventSiteUrl(site.rootDomain, e.subdomain);
    return url ? (
      <a className="btn btn-secondary btn-small" href={url} aria-label={`Open ${e.name}'s site`}>
        Open site
      </a>
    ) : (
      <ButtonLink small to={`/events/${e.id}`} aria-label={`Open ${e.name}`}>
        Open
      </ButtonLink>
    );
  };
  const badges = (e: EventSummary) => (
    <span className="badges">
      <Badge tone={STATUS[e.status]!.tone}>{STATUS[e.status]!.label}</Badge>
      {e.isDemo && <Badge tone="info">Demo</Badge>}
    </span>
  );

  return (
    <>
      <PageHeader
        title="Camps"
        summary={events.length > 0 && `${plural(events.length, 'camp')} · ${counts.current} current`}
        help="Each camp has its own address, logo and colour. Staff only ever see their own camp."
        primary={
          canCreate && (
            <ButtonLink to="/camps/new" kind="primary">
              <Icon name="plus" />
              Create camp
            </ButtonLink>
          )
        }
      />
      {events.length === 0 ? (
        <EmptyState title="No camps yet" actions={canCreate && <ButtonLink to="/camps/new" kind="primary">Create camp</ButtonLink>}>
          Create a camp, then add its staff.
        </EmptyState>
      ) : (
        <div className="pf-stack">
          <Toolbar sticky label="Find camps">
            <SearchField id="camps-q" label="Search camps" placeholder="Search camps" value={q} onChange={setQ} slash />
            <FilterChips
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All', count: counts.all },
                { value: 'current', label: 'Current', count: counts.current },
                { value: 'past', label: 'Past', count: counts.past },
                { value: 'demo', label: 'Demo', count: counts.demo },
              ]}
            />
          </Toolbar>
          {groups.length === 0 ? (
            <EmptyState title="No camps match" actions={filtered && <Button onClick={clear}>Clear filters</Button>} />
          ) : wide ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader label="Camp" column="name" sort={sort} onSort={toggle} />
                    <th scope="col">Address</th>
                    <SortHeader label="Dates" column="dates" sort={sort} onSort={toggle} />
                    <SortHeader label="Status" column="status" sort={sort} onSort={toggle} />
                    <th scope="col" className="cell-action">
                      <span className="visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                {groups.map((g) => (
                  <tbody key={g.title}>
                    <tr className="pf-group-row">
                      <th scope="colgroup" colSpan={5}>
                        {g.title} <span className="pf-group-count">{g.list.length}</span>
                      </th>
                    </tr>
                    {g.list.map((e) => (
                      <tr key={e.id} className="row-link">
                        <td>
                          <span className="camp-cell">
                            <CampMark event={e} size={32} />
                            <Link to={`/camps/${e.id}`} className="cell-link">
                              {e.name}
                            </Link>
                          </span>
                        </td>
                        <td>{address(e) ?? <span className="meta">Not set</span>}</td>
                        <td className="num pf-nowrap">{formatDateRange(e.startsOn, e.endsOn)}</td>
                        <td>{badges(e)}</td>
                        <td className="cell-action">{openSite(e)}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          ) : (
            groups.map((g) => (
              <div className="list" key={g.title}>
                <h2 className="list-group-heading">
                  {g.title} <span className="pf-group-count">{g.list.length}</span>
                </h2>
                <ul>
                  {g.list.map((e) => (
                    <li key={e.id} className="row row-link row-large">
                      <CampMark event={e} />
                      <span className="row-main">
                        <span className="row-title">
                          <Link to={`/camps/${e.id}`}>{e.name}</Link>
                        </span>
                        <span className="row-meta">{[address(e) ?? 'No address yet', formatDateRange(e.startsOn, e.endsOn)].join(' · ')}</span>
                      </span>
                      {badges(e)}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

interface BrandingValue {
  name: string;
  subdomain: string;
  brandColor: string;
  /** A new logo to upload (data URL), '' to remove it, or null to leave it. */
  logo: string | null;
}

/**
 * Name, address, colour and logo: shared by Create camp and a camp's page.
 * `part` renders just the name and address ("identity") or just the colour and logo ("look").
 */
function BrandingFields({
  value,
  onChange,
  errors,
  currentLogo,
  rootDomain,
  suggest,
  part,
}: {
  value: BrandingValue;
  onChange: (v: BrandingValue) => void;
  errors: Record<string, string>;
  currentLogo: string | null;
  rootDomain: string | null;
  suggest: boolean;
  part?: 'identity' | 'look';
}) {
  const [logoError, setLogoError] = useState<string | null>(null);
  const set = (patch: Partial<BrandingValue>) => onChange({ ...value, ...patch });
  const shown = accessibleBrand(value.brandColor);
  const adjusted = shown.toLowerCase() !== value.brandColor.toLowerCase();
  const preview = value.logo === '' ? null : (value.logo ?? currentLogo);
  return (
    <>
      {part !== 'look' && (
        <>
          <Field id="camp-name" label="Camp name" error={errors.name}>
            <input
              className="input"
              value={value.name}
              autoComplete="off"
              onChange={(e) => {
                const name = e.target.value;
                set(suggest ? { name, subdomain: suggestSubdomain(name) } : { name });
              }}
            />
          </Field>
          <Field id="camp-address" label="Address" error={errors.subdomain} hint="Lowercase letters, numbers and hyphens">
            <span className="address-input" id="camp-address-row">
              <input
                id="camp-address"
                className="input"
                aria-describedby={errors.subdomain ? 'camp-address-hint camp-address-error' : 'camp-address-hint'}
                aria-invalid={errors.subdomain ? true : undefined}
                value={value.subdomain}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => set({ subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              />
              <span className="address-suffix">.{rootDomain ?? 'campcount.com'}</span>
            </span>
          </Field>
        </>
      )}
      {part !== 'identity' && (
        <>
          <Field id="camp-colour" label="Colour" hint={adjusted ? `Darkened to ${shown} so white text stays readable` : undefined} error={errors.brandColor}>
            <span className="colour-input" id="camp-colour-row">
              <input type="color" className="colour-swatch" aria-label="Pick a colour" value={value.brandColor} onChange={(e) => set({ brandColor: e.target.value })} />
              <input
                id="camp-colour"
                className="input"
                aria-describedby={[adjusted && 'camp-colour-hint', errors.brandColor && 'camp-colour-error'].filter(Boolean).join(' ') || undefined}
                aria-invalid={errors.brandColor ? true : undefined}
                value={value.brandColor}
                maxLength={7}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => set({ brandColor: e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}` })}
              />
              <span className="colour-sample" style={{ background: shown, color: contrast(shown, '#ffffff') >= 4.5 ? '#fff' : '#000' }} aria-hidden="true">
                Start scanning
              </span>
            </span>
          </Field>
          <div className="field">
            <label htmlFor="camp-logo" className="field-label">
              Logo <span className="field-optional">(optional)</span>
            </label>
            <span className="field-hint" id="camp-logo-hint">
              PNG, JPEG or WebP, up to 300 KB. Square is best.
            </span>
            <div className="logo-input">
              {preview ? <img src={preview} alt="Logo preview" width={56} height={56} className="camp-mark" /> : <CampMark event={{ name: value.name || 'C', logoUrl: null, brandColor: value.brandColor }} size={56} />}
              <input
                id="camp-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-describedby={logoError ? 'camp-logo-hint camp-logo-error' : 'camp-logo-hint'}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  setLogoError(null);
                  if (!file) return;
                  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setLogoError('Choose a PNG, JPEG or WebP image');
                  if (file.size > 300 * 1024) return setLogoError('That image is over 300 KB. Choose a smaller one');
                  set({ logo: await readFile(file) });
                }}
              />
              {preview && (
                <Button small kind="ghost" onClick={() => set({ logo: '' })}>
                  Remove logo
                </Button>
              )}
            </div>
            {logoError && (
              <span className="field-error" id="camp-logo-error">
                <Icon name="error" size={16} />
                {logoError}
              </span>
            )}
          </div>
        </>
      )}
    </>
  );
}

async function saveLogo(eventId: string, logo: string | null) {
  if (logo === null) return;
  if (logo === '') await api(`/events/${eventId}/logo`, { method: 'DELETE' });
  else await api(`/events/${eventId}/logo`, { method: 'PUT', body: { dataUrl: logo } });
}

function checkBranding(v: BrandingValue): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.name.trim()) e.name = 'Enter the camp name';
  const problem = subdomainProblem(v.subdomain);
  if (problem) e.subdomain = problem;
  if (!/^#[0-9a-fA-F]{6}$/.test(v.brandColor)) e.brandColor = 'Choose a colour like #1F5C46';
  return e;
}

const LABELS: Record<string, string> = { name: 'Camp name', subdomain: 'Address', brandColor: 'Colour', startsOn: 'First day', endsOn: 'Last day' };

/** Create camp: name, address, branding, dates and what it will use. */
export function NewCamp() {
  const navigate = useNavigate();
  const toast = useToast();
  const site = useSite();
  const [brand, setBrand] = useState<BrandingValue>({ name: '', subdomain: '', brandColor: DEFAULT_BRAND, logo: null });
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [location, setLocation] = useState('');
  const [features, setFeatures] = useState<EventFeatures>({ activities: true, meals: true, site: true, dietary: true, photo: false, selfSignup: false, sideQuest: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = checkBranding(brand);
    if (!startsOn) found.startsOn = 'Choose the first day';
    if (!endsOn) found.endsOn = 'Choose the last day';
    else if (startsOn && endsOn < startsOn) found.endsOn = 'The last day must be on or after the first day';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const { event } = await api<{ event: EventSummary }>('/events', {
        body: { name: brand.name.trim(), subdomain: brand.subdomain, brandColor: brand.brandColor, startsOn, endsOn, location, features },
      });
      try {
        await saveLogo(event.id, brand.logo);
      } catch {
        toast("The camp was created, but the logo didn't upload. Try again from the camp's page.", { tone: 'error' });
      }
      toast(`${event.name} created`);
      navigate(`/camps/${event.id}`);
    } catch (err) {
      if (err instanceof ApiFailure) {
        const fields = err.fieldErrors();
        setErrors(Object.keys(fields).length ? fields : { form: err.message });
      } else setErrors({ form: 'No connection. Check your signal and try again.' });
    } finally {
      setBusy(false);
    }
  }

  const suggest = !brand.subdomain || brand.subdomain === suggestSubdomain(brand.name.slice(0, -1)) || brand.subdomain === suggestSubdomain(brand.name);
  return (
    <>
      <PageHeader title="Create camp" back={{ to: '/', label: 'Camps' }} />
      <form className="pf-form" onSubmit={submit} noValidate>
        <ErrorSummary errors={Object.entries(errors).map(([k, m]) => ({ id: k === 'form' ? 'camp-name' : k === 'subdomain' ? 'camp-address' : k === 'brandColor' ? 'camp-colour' : k === 'name' ? 'camp-name' : `camp-${k}`, message: k === 'form' ? m : `${LABELS[k] ?? k}: ${m}` }))} />
        <div className="pf-split">
          <div className="pf-stack">
            <fieldset className="pf-panel">
              <legend className="pf-panel-title">Camp</legend>
              <BrandingFields value={brand} onChange={setBrand} errors={errors} currentLogo={null} rootDomain={site.rootDomain} suggest={suggest} part="identity" />
              <div className="field-pair">
                <Field id="camp-startsOn" label="First day" error={errors.startsOn}>
                  <input className="input" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
                </Field>
                <Field id="camp-endsOn" label="Last day" error={errors.endsOn}>
                  <input className="input" type="date" value={endsOn} min={startsOn || undefined} onChange={(e) => setEndsOn(e.target.value)} />
                </Field>
              </div>
              <Field id="camp-location" label="Location" optional>
                <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} autoComplete="off" />
              </Field>
            </fieldset>
            <fieldset className="pf-panel">
              <legend className="pf-panel-title">Look</legend>
              <BrandingFields value={brand} onChange={setBrand} errors={errors} currentLogo={null} rootDomain={site.rootDomain} suggest={suggest} part="look" />
            </fieldset>
          </div>
          <div className="pf-panel">
            <FeatureChecklist value={features} onChange={setFeatures} />
          </div>
        </div>
        <div className="pf-actionbar">
          <Button type="submit" kind="primary" busy={busy} busyLabel="Creating…">
            Create camp
          </Button>
          <ButtonLink to="/">Cancel</ButtonLink>
        </div>
      </form>
    </>
  );
}

/** One camp in the admin console: its address and branding, and the way into its own site. */
export function CampPage() {
  const { campId } = useParams();
  const site = useSite();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { me } = useSession();
  const canDelete = me?.kind === 'user' && me.platformPermissions.includes('platform.events.oversee');
  const { data, error, loading, reload } = useApi<{ event: EventSummary }>(`/events/${campId}`);
  const [brand, setBrand] = useState<BrandingValue | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const saved = (ev: EventSummary): BrandingValue => ({ name: ev.name, subdomain: ev.subdomain ?? '', brandColor: ev.brandColor ?? DEFAULT_BRAND, logo: null });
  useEffect(() => {
    if (data) setBrand(saved(data.event));
  }, [data]);

  if (loading && !data)
    return (
      <Loading what="camp">
        <SkeletonHeader />
        <SkeletonRows rows={4} />
      </Loading>
    );
  if (error)
    return (
      <>
        <PageHeader title="Camp" back={{ to: '/', label: 'Camps' }} />
        <LoadError error={error} onRetry={reload} what="this camp" />
      </>
    );
  if (!data || !brand) return null;
  const e = data.event;
  const url = eventSiteUrl(site.rootDomain, e.subdomain);
  const fallback = `/events/${e.id}`;
  const was = saved(e);
  const dirty = brand.name !== was.name || brand.subdomain !== was.subdomain || brand.brandColor.toLowerCase() !== was.brandColor.toLowerCase() || brand.logo !== null;

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const found = checkBranding(brand!);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await api(`/events/${e.id}`, { method: 'PATCH', body: { name: brand!.name.trim(), subdomain: brand!.subdomain, brandColor: brand!.brandColor } });
      await saveLogo(e.id, brand!.logo);
      toast('Changes saved');
      await reload();
    } catch (err) {
      if (err instanceof ApiFailure) {
        const fields = err.fieldErrors();
        setErrors(Object.keys(fields).length ? fields : { form: err.message });
      } else setErrors({ form: 'No connection. Check your signal and try again.' });
    } finally {
      setBusy(false);
    }
  }

  async function deleteCamp() {
    const ok = await confirm({
      title: `Delete ${e.name}?`,
      body: (
        <p>
          Everything in this camp is deleted for good: its people, lanyards, scans, dietary records, activities, meals, stations, logo and address. Staff accounts
          are kept but lose access. Download anything you need from Reports first. This can't be undone.
        </p>
      ),
      confirm: 'Delete camp',
      danger: true,
      typeToConfirm: 'DELETE',
    });
    if (!ok) return;
    try {
      await api(`/admin/events/${e.id}`, { method: 'DELETE' });
      toast(`Deleted ${e.name}`);
      navigate('/', { replace: true });
    } catch (err) {
      toast(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.', { tone: 'error' });
    }
  }

  const steps = [
    { label: 'Add staff', hint: 'Managers, scanners, leaders, meal team', path: 'settings/staff', icon: 'team' as const },
    { label: 'Add people', hint: 'Import a spreadsheet or add one by one', path: 'people', icon: 'user' as const },
    { label: 'Details and features', hint: 'Dates, location, notes, features', path: 'settings/event', icon: 'clipboard' as const },
  ];

  return (
    <>
      <PageHeader
        title={e.name}
        back={{ to: '/', label: 'Camps' }}
        summary={
          <>
            <span className="sep">{addressText(site.rootDomain, e.subdomain) ?? 'No address yet'}</span>
            <span className="sep">{formatDateRange(e.startsOn, e.endsOn)}</span>
            <Badge tone={STATUS[e.status]!.tone}>{STATUS[e.status]!.label}</Badge>
            {e.isDemo && <Badge tone="info">Demo</Badge>}
          </>
        }
        primary={
          url ? (
            <a className="btn btn-primary" href={url}>
              Open camp site
            </a>
          ) : (
            <ButtonLink to={fallback} kind="primary">
              Open camp
            </ButtonLink>
          )
        }
        menu={canDelete ? [{ label: 'Delete camp…', danger: true, onSelect: () => void deleteCamp() }] : undefined}
        menuLabel={`More actions for ${e.name}`}
      />
      <div className="pf-split pf-split-wide">
        <form className="pf-form" onSubmit={save} noValidate aria-labelledby="branding-heading">
          <ErrorSummary errors={Object.entries(errors).map(([k, m]) => ({ id: k === 'subdomain' ? 'camp-address' : k === 'brandColor' ? 'camp-colour' : 'camp-name', message: k === 'form' ? m : `${LABELS[k] ?? k}: ${m}` }))} />
          <section className="pf-panel">
            <h2 className="pf-panel-title" id="branding-heading">
              Address and branding
            </h2>
            <div className="pf-form-grid">
              <div className="pf-stack">
                <BrandingFields value={brand} onChange={setBrand} errors={errors} currentLogo={e.logoUrl} rootDomain={site.rootDomain} suggest={false} part="identity" />
              </div>
              <div className="pf-stack">
                <BrandingFields value={brand} onChange={setBrand} errors={errors} currentLogo={e.logoUrl} rootDomain={site.rootDomain} suggest={false} part="look" />
              </div>
            </div>
            {e.subdomain && brand.subdomain !== e.subdomain && <Banner tone="warning">A new address breaks old links. Tell the camp's staff.</Banner>}
          </section>
          <div className="pf-actionbar">
            <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
              Save changes
            </Button>
            {dirty && (
              <>
                <Button kind="ghost" onClick={() => setBrand(was)}>
                  Discard
                </Button>
                <span className="pf-dirty">Unsaved changes</span>
              </>
            )}
          </div>
        </form>
        <section className="pf-panel" aria-labelledby="next-heading">
          <div className="pf-panel-head">
            <h2 className="pf-panel-title" id="next-heading">
              Next steps
            </h2>
            {url && <InfoTip label="About these links">These open on the camp's own site. Sign in there with your CampCount account.</InfoTip>}
          </div>
          <ul className="pf-links">
            {steps.map((s) => (
              <li key={s.path} className="row row-link">
                <Icon name={s.icon} />
                <span className="row-main">
                  <span className="row-title">{url ? <a href={eventSiteUrl(site.rootDomain, e.subdomain, `/${s.path}`)!}>{s.label}</a> : <Link to={`${fallback}/${s.path}`}>{s.label}</Link>}</span>
                  <span className="row-meta">{s.hint}</span>
                </span>
                <span className="row-chevron">
                  <Icon name="chevron" />
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
