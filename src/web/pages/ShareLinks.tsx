import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router';
import type { LinkFeature } from '../../shared/participantLinks';
import { LINK_FEATURES, LINK_FEATURE_INFO } from '../../shared/participantLinks';
import { ApiFailure, api } from '../api';
import { useApi } from '../useApi';
import { Badge, Banner, Button, ButtonLink, EmptyState, Field, Icon, LoadError, Loading, Menu, PageHeader, Sheet, Toggle, useConfirm, useToast } from '../ui';
import { useEvent } from './EventLayout';
import { eventSiteUrl, useSite } from '../site';

interface ShareLink {
  id: string;
  name: string;
  features: LinkFeature[];
  active: boolean;
  /** The link for the camp's own address (Participant on its front page). */
  home: boolean;
  url: string;
}

const PRESETS: { name: string; features: LinkFeature[]; about: string }[] = [
  { name: 'Everything', features: [...LINK_FEATURES], about: 'Programme, booking, teams and food' },
  { name: 'Book activities', features: ['book'], about: 'Just booking and cancelling' },
  { name: 'Programme and food', features: ['programme', 'food'], about: 'Look only, nothing to change' },
];

const HELP =
  'One link for all participants. They type their Scouts SA membership number and see their own camp page, with only the parts you switch on. Surnames, groups, team-mates and dietary details are never shown. Changes apply the next time someone opens the link. Each person’s own lanyard QR still opens their full page. Typing numbers is limited per device, so nobody can try lots of numbers.';

/**
 * People › Links for everyone: one link to send to every participant. They
 * type their membership number and see their camp page, with only the parts
 * this link switches on. Make as many as you like (one for booking, one
 * for everything…) and switch parts on and off at any time.
 */
export function ShareLinks() {
  const { event, can, base } = useEvent();
  const site = useSite();
  const siteUrl = eventSiteUrl(site.rootDomain, event.subdomain);
  const siteName = siteUrl ? siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi<{ links: ShareLink[] }>(`/events/${event.id}/participant-links`);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [features, setFeatures] = useState<LinkFeature[]>([...LINK_FEATURES]);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ link: ShareLink; name: string } | null>(null);
  const back = { to: `${base}/links`, label: 'Links' };
  if (!can('activities.manage')) return <Navigate to={back.to} replace />;

  const links = data?.links ?? [];
  const header = (
    <PageHeader
      title="Links for everyone"
      back={back}
      summary={data && links.length > 0 ? `${links.length} link${links.length === 1 ? '' : 's'} · ${links.filter((l) => l.active).length} on` : undefined}
      help={HELP}
      primary={
        <Button kind="primary" onClick={() => (setFailure(null), setMaking(true))}>
          <Icon name="plus" /> New link
        </Button>
      }
    />
  );
  if (loading && !data) return (<>{header}<Loading what="the links" rows={3} /></>);
  if (error || !data) return (<>{header}<LoadError error={error!} onRetry={reload} what="the links" /></>);

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  };

  async function run(id: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(id);
    try {
      await fn();
      await reload();
      if (done) toast(done);
    } catch (err) {
      toast(err instanceof ApiFailure ? err.message : 'No connection. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function make(n: string, f: LinkFeature[]) {
    setFailure(null);
    try {
      const res = await api<{ link: ShareLink }>(`/events/${event.id}/participant-links`, { body: { name: n, features: f } });
      await reload();
      setMaking(false);
      setName('');
      setFeatures([...LINK_FEATURES]);
      await navigator.clipboard?.writeText(res.link.url).catch(() => undefined);
      toast('Link made and copied');
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'No connection. Try again.');
    }
  }

  const patch = (l: ShareLink, body: object, done?: string) => run(l.id, () => api(`/events/${event.id}/participant-links/${l.id}`, { method: 'PATCH', body }), done);
  const onWebsite = links.find((l) => l.home && l.active);

  return (
    <>
      {header}
      <div className="sections share-links">
        {(!event.features.selfSignup || siteName) && (
          <div className="banners">
            {!event.features.selfSignup && (
              <Banner
                tone="warning"
                action={
                  can('event.configure') ? (
                    <ButtonLink to={`${base}/settings/event`} small>
                      Event details
                    </ButtonLink>
                  ) : undefined
                }
              >
                Activity sign-up is off <span className="meta">· booking shows as closed</span>
              </Banner>
            )}
            {siteName && (
              <Banner>
                <strong>{siteName}</strong>{' '}
                {onWebsite ? (
                  <span className="meta">· participants get “{onWebsite.name}”</span>
                ) : (
                  <span className="meta">· only offers Event team sign-in. Choose a link with ⋯ › Use on the camp website.</span>
                )}
              </Banner>
            )}
          </div>
        )}

        {links.length === 0 ? (
          <EmptyState
            title="No links yet"
            actions={
              <div className="share-presets">
                {PRESETS.map((p) => (
                  <button key={p.name} type="button" className="share-preset" onClick={() => void make(p.name, p.features)}>
                    <strong>{p.name}</strong>
                    <span className="meta">{p.about}</span>
                  </button>
                ))}
              </div>
            }
          >
            Start with one of these. You can change what each link shows at any time.
          </EmptyState>
        ) : (
          <ul className="share-list">
            {links.map((l) => (
              <li key={l.id} className={l.active ? 'panel share-link' : 'panel share-link is-off'}>
                <div className="share-link-head">
                  <h2>{l.name}</h2>
                  {l.home && <Badge tone="brand">Camp website</Badge>}
                  {!l.active && <Badge tone="warning">Switched off</Badge>}
                  <Toggle
                    checked={l.active}
                    disabled={busy === l.id}
                    onChange={(on) => void patch(l, { active: on }, on ? 'Link switched on' : 'Link switched off')}
                    label={<span className="share-onoff">{l.active ? 'On' : 'Off'}<span className="visually-hidden">: {l.name}</span></span>}
                  />
                  <Menu
                    label={`More actions for ${l.name}`}
                    items={[
                      { label: 'Rename…', onSelect: () => setRenaming({ link: l, name: l.name }) },
                      !!siteName && {
                        label: l.home ? 'Stop using on the camp website' : `Use on the camp website (${siteName})`,
                        onSelect: () => void patch(l, { home: !l.home }, l.home ? 'No longer on the camp website' : 'Now on the camp website'),
                      },
                      { label: l.active ? 'Switch off' : 'Switch on', onSelect: () => void patch(l, { active: !l.active }, l.active ? 'Link switched off' : 'Link switched on') },
                      {
                        label: 'Make a new address…',
                        onSelect: async () => {
                          if (!(await confirm({ title: 'Make a new address?', body: <p>The address you’ve already sent stops working.</p>, confirm: 'Make new address', danger: true }))) return;
                          void run(l.id, () => api(`/events/${event.id}/participant-links/${l.id}/new-code`, { body: {} }), 'New address made');
                        },
                      },
                      {
                        label: 'Delete link…',
                        danger: true,
                        onSelect: async () => {
                          if (!(await confirm({ title: `Delete ${l.name}?`, body: <p>The link stops working for everyone you sent it to.</p>, confirm: 'Delete link', danger: true }))) return;
                          void run(l.id, () => api(`/events/${event.id}/participant-links/${l.id}`, { method: 'DELETE' }), 'Link deleted');
                        },
                      },
                    ]}
                  />
                </div>
                <div className="share-url">
                  <code>{l.url}</code>
                  <Button small onClick={() => void copy(l.url)}>
                    <Icon name="copy" /> Copy
                  </Button>
                  <a className="btn btn-small btn-ghost" href={l.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </div>
                <div className="share-toggles" role="group" aria-label={`What ${l.name} shows`}>
                  <span className="share-toggles-label">Shows</span>
                  {LINK_FEATURES.map((f) => {
                    const on = l.features.includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        className={on ? 'share-toggle is-on' : 'share-toggle'}
                        aria-pressed={on}
                        disabled={busy === l.id || (on && l.features.length === 1)}
                        title={on && l.features.length === 1 ? 'A link needs at least one part switched on' : LINK_FEATURE_INFO[f].hint}
                        onClick={() => void patch(l, { features: on ? l.features.filter((x) => x !== f) : LINK_FEATURES.filter((x) => x === f || l.features.includes(x)) })}
                      >
                        {on && <Icon name="check" size={16} />}
                        {LINK_FEATURE_INFO[f].label}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Sheet open={making} title="New link" onClose={() => setMaking(false)}>
        {making && (
          <form
            className="form share-new"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void make(name.trim() || 'Camp page', features);
            }}
          >
            {failure && <Banner tone="error">{failure}</Banner>}
            <Field id="share-name" label="Name" hint="Only you see it. For example, “Pre-camp email”.">
              <input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </Field>
            <fieldset className="share-features">
              <legend className="field-label">What people can see and do</legend>
              {LINK_FEATURES.map((f) => (
                <Toggle
                  key={f}
                  checked={features.includes(f)}
                  onChange={(checked) => setFeatures((fs) => (checked ? LINK_FEATURES.filter((x) => x === f || fs.includes(x)) : fs.filter((x) => x !== f)))}
                  label={LINK_FEATURE_INFO[f].label}
                  hint={LINK_FEATURE_INFO[f].hint}
                />
              ))}
            </fieldset>
            <div className="btn-row">
              <Button type="submit" kind="primary" disabled={features.length === 0}>
                Make link
              </Button>
              <Button onClick={() => setMaking(false)}>Cancel</Button>
            </div>
          </form>
        )}
      </Sheet>

      <Sheet open={renaming !== null} title="Rename link" onClose={() => setRenaming(null)}>
        {renaming && (
          <form
            className="form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const n = renaming.name.trim();
              if (n && n !== renaming.link.name) void patch(renaming.link, { name: n }, 'Renamed');
              setRenaming(null);
            }}
          >
            <Field id="share-rename" label="Name for this link">
              <input className="input" maxLength={60} value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} autoComplete="off" />
            </Field>
            <div className="btn-row">
              <Button type="submit" kind="primary" disabled={!renaming.name.trim()}>
                Rename
              </Button>
              <Button onClick={() => setRenaming(null)}>Cancel</Button>
            </div>
          </form>
        )}
      </Sheet>
    </>
  );
}
