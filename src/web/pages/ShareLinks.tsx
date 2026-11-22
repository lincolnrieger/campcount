import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router';
import type { LinkFeature } from '../../shared/participantLinks';
import { LINK_FEATURES, LINK_FEATURE_INFO } from '../../shared/participantLinks';
import { ApiFailure, api } from '../api';
import { useApi } from '../useApi';
import { Badge, Button, EmptyState, Field, Icon, LoadError, Loading, Menu, Notice, PageHeader, useConfirm, useToast } from '../ui';
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
  const back = { to: `${base}/people`, label: 'People' };
  if (!can('activities.manage')) return <Navigate to={back.to} replace />;

  const header = (
    <PageHeader
      title="Links for everyone"
      back={back}
      summary="One link for all participants. They type their Scouts SA membership number and see their own camp page, with only the parts you switch on. Surnames, groups, team-mates and dietary details are never shown on these pages."
      primary={
        !making && (
          <Button kind="primary" onClick={() => setMaking(true)}>
            <Icon name="plus" /> New link
          </Button>
        )
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

  return (
    <>
      {header}
      <div className="sections share-links">
        {!event.features.selfSignup && (
          <Notice tone="warning">
            <p>Activity sign-up is switched off for this camp, so booking shows as closed. Turn it on in Settings › Event details.</p>
          </Notice>
        )}

        {siteName && (
          <Notice tone="info">
            <p>
              <strong>{siteName}</strong> asks people whether they’re a participant or on the event team.{' '}
              {data.links.some((l) => l.home && l.active)
                ? 'Participants get the link marked “Camp website”. Give your other links more parts to test with.'
                : 'Choose a link for participants with ⋯ › Use on the camp website. Until then it only offers Event team sign-in.'}
            </p>
          </Notice>
        )}

        {making && (
          <form
            className="panel panel-pad form share-new"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void make(name.trim() || 'Camp page', features);
            }}
          >
            <h2>New link</h2>
            {failure && (
              <Notice tone="error">
                <p>{failure}</p>
              </Notice>
            )}
            <Field id="share-name" label="Name" hint="Just for you, so you can tell links apart. For example, “Pre-camp email”.">
              <input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </Field>
            <fieldset className="share-features">
              <legend className="field-label">What people can see and do</legend>
              {LINK_FEATURES.map((f) => (
                <label key={f} className="choice">
                  <input type="checkbox" checked={features.includes(f)} onChange={(e) => setFeatures((fs) => (e.target.checked ? LINK_FEATURES.filter((x) => x === f || fs.includes(x)) : fs.filter((x) => x !== f)))} />
                  <span className="choice-text">
                    <span>{LINK_FEATURE_INFO[f].label}</span>
                    <span className="meta">{LINK_FEATURE_INFO[f].hint}</span>
                  </span>
                </label>
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

        {data.links.length === 0 && !making ? (
          <EmptyState title="No links yet">
            <p>Start with one of these. You can change what each link shows at any time.</p>
            <div className="share-presets">
              {PRESETS.map((p) => (
                <button key={p.name} type="button" className="share-preset" onClick={() => void make(p.name, p.features)}>
                  <strong>{p.name}</strong>
                  <span className="meta">{p.about}</span>
                </button>
              ))}
            </div>
          </EmptyState>
        ) : (
          <ul className="share-list">
            {data.links.map((l) => (
              <li key={l.id} className={l.active ? 'panel panel-pad share-link' : 'panel panel-pad share-link is-off'}>
                <div className="share-link-head">
                  <h2>{l.name}</h2>
                  {l.home && <Badge tone="brand">Camp website</Badge>}
                  {!l.active && <Badge tone="warning">Switched off</Badge>}
                  <Menu
                    label={`More actions for ${l.name}`}
                    items={[
                      {
                        label: 'Rename…',
                        onSelect: () => {
                          const n = window.prompt('Name for this link', l.name)?.trim();
                          if (n && n !== l.name) void patch(l, { name: n }, 'Renamed');
                        },
                      },
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
        <p className="meta">
          Changes apply the next time someone opens the link. Each person’s own lanyard QR code still opens their full page. Typing numbers is limited per device, so nobody can
          try lots of numbers.
        </p>
      </div>
    </>
  );
}
