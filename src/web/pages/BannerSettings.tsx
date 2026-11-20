import { useState } from 'react';
import { Navigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { prepareImage } from '../lanyards/edit';
import { useApi } from '../useApi';
import { Button, Icon, LoadError, Loading, Notice, PageHeader, useConfirm, useToast } from '../ui';
import { useEvent } from './EventLayout';

type Banner = { url: string; width: number; height: number } | null;

/** Settings › Participant page banner: one graphic for this camp, across the top of everyone's page. */
export function BannerSettings() {
  const { event, can, base } = useEvent();
  const { data, error, loading, reload } = useApi<{ banner: Banner }>(can('event.configure') ? `/events/${event.id}/banner` : null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const editable = event.status === 'draft' || event.status === 'open';
  const back = { to: `${base}/settings`, label: 'Settings' };
  if (!can('event.configure')) return <Navigate to={back.to} replace />;

  async function upload(file: File) {
    setProblem(null);
    setBusy(true);
    try {
      const { dataUrl, width, height } = await prepareImage(file);
      await api(`/events/${event.id}/banner`, { method: 'PUT', body: { dataUrl, width, height } });
      await reload();
      toast('Banner saved');
    } catch (err) {
      setProblem(err instanceof ApiFailure || err instanceof Error ? err.message : 'No connection. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  const banner = data?.banner ?? null;
  return (
    <>
      <PageHeader
        title="Participant page banner"
        back={back}
        summary="A graphic for this camp, shown across the top of every participant’s page (the page their lanyard opens) instead of the camp’s name. A wide image works best, about 2 to 1."
      />
      {loading && !data ? (
        <Loading what="the banner" rows={2} />
      ) : error ? (
        <LoadError error={error} onRetry={reload} what="the banner" />
      ) : (
        <div className="form">
          {problem && (
            <Notice tone="error">
              <p>{problem}</p>
            </Notice>
          )}
          {banner ? (
            <img className="banner-preview" src={banner.url} width={banner.width} height={banner.height} alt={`${event.name} banner`} />
          ) : (
            <p className="meta">No banner yet. Participants see the camp’s name instead.</p>
          )}
          {editable && (
            <div className="btn-row">
              <label className={busy ? 'btn btn-primary is-busy' : 'btn btn-primary'}>
                <Icon name="image" />
                {busy ? 'Uploading…' : banner ? 'Replace banner' : 'Upload banner'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="visually-hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void upload(file);
                  }}
                />
              </label>
              {banner && (
                <Button
                  kind="ghost"
                  disabled={busy}
                  onClick={async () => {
                    if (!(await confirm({ title: 'Remove the banner?', body: <p>Participants will see the camp’s name instead.</p>, confirm: 'Remove', danger: true }))) return;
                    try {
                      await api(`/events/${event.id}/banner`, { method: 'DELETE' });
                      await reload();
                      toast('Banner removed');
                    } catch (err) {
                      setProblem(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');
                    }
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
