import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { LanyardCard } from '../components/LanyardCard';
import type { Card } from '../lanyards/pdf';
import type { LanyardSettings as Settings, PhotoMarker } from '../../shared/schemas';
import { PHOTO_MARKERS } from '../../shared/schemas';
import { Button, Choice, Field, Icon, Notice, PageHeader, useToast } from '../ui';
import { useEvent } from './EventLayout';

export const PHOTO_MARKER_WORDS: Record<PhotoMarker, string> = {
  black_border: 'Black border',
  colour_border: 'Coloured border',
  red_dot: 'Red circle',
  camera_icon: 'Crossed-out camera',
  none: 'No marker',
};

const HINTS: Record<PhotoMarker, string> = {
  black_border: 'A thick black frame around the whole card, front and back. Easy to spot from across a field.',
  colour_border: 'The same frame in a colour you choose.',
  red_dot: 'A red circle on the coloured band.',
  camera_icon: 'A black camera with a line through it on the band.',
  none: 'Nothing extra on the card. Photographers check the list instead.',
};

const SAMPLE: Card = {
  registrationId: 'sample',
  name: 'Sam Taylor',
  kind: 'youth',
  section: 'Scouts',
  groupName: '1st Example Scout Group',
  shortCode: 'K7QM-3XRP',
  qr: 'https://campcount.com/c#sample-card-preview-only',
  noPhotos: true,
};

/** Settings › Lanyards: how a card shows that someone has no photo consent. */
export function LanyardSettings() {
  const { event, can, reload, base } = useEvent();
  const navigate = useNavigate();
  const toast = useToast();
  const [value, setValue] = useState<Settings>(event.lanyard);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = { to: `${base}/settings`, label: 'Settings' };
  const editable = event.status === 'draft' || event.status === 'open';

  if (!can('event.configure')) return <Navigate to={back.to} replace />;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await api(`/events/${event.id}`, { method: 'PATCH', body: { lanyard: value } });
      await reload();
      toast('Changes saved');
      navigate(back.to);
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Lanyards" back={back} summary="How a lanyard shows that someone has no photo consent. Anyone without a yes on file counts." />
      <div className="lanyard-settings">
        <form className="form" onSubmit={save} noValidate>
          {!event.features.photo && (
            <Notice title="Photo consent is turned off for this event">
              <p>Turn on Photos in Event details for these markers to print.</p>
            </Notice>
          )}
          {failure && (
            <p className="field-error" role="alert">
              <Icon name="error" size={16} />
              {failure}
            </p>
          )}
          <fieldset className="form" disabled={!editable || busy}>
            <fieldset className="field">
              <legend className="field-label">Marker</legend>
              <div className="choices">
                {PHOTO_MARKERS.map((m) => (
                  <Choice
                    key={m}
                    type="radio"
                    name="photo-marker"
                    label={<strong>{PHOTO_MARKER_WORDS[m]}</strong>}
                    description={HINTS[m]}
                    checked={value.photoMarker === m}
                    onChange={() => setValue({ ...value, photoMarker: m })}
                  />
                ))}
              </div>
            </fieldset>
            {value.photoMarker === 'colour_border' && (
              <Field id="marker-colour" label="Border colour">
                <input className="input input-colour" type="color" value={value.photoMarkerColour} onChange={(e) => setValue({ ...value, photoMarkerColour: e.target.value.toUpperCase() })} />
              </Field>
            )}
            <fieldset className="choices">
              <legend className="visually-hidden">Label</legend>
              <Choice
                label='Print "No photos" on the band'
                description="Small words beside Scout, Venturer, Rover or Leader."
                checked={value.photoMarkerLabel}
                onChange={(e) => setValue({ ...value, photoMarkerLabel: e.target.checked })}
              />
            </fieldset>
          </fieldset>
          {editable && (
            <div className="btn-row">
              <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
                Save changes
              </Button>
              <Button onClick={() => navigate(back.to)}>Cancel</Button>
            </div>
          )}
        </form>
        <div className="lanyard-sample" aria-label="Preview">
          <p className="meta">Preview</p>
          <LanyardCard card={SAMPLE} marker={value} />
        </div>
      </div>
    </>
  );
}
