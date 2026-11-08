import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { LanyardBack, LanyardCard } from '../components/LanyardCard';
import { useLanyardArtwork } from '../lanyards/artwork';
import type { Card, CardSide, CardSize } from '../lanyards/pdf';
import { CARD_SIZES, artworkPixels, buildTemplatePdf, buildTemplatePng, downloadBlob, downloadPdf } from '../lanyards/pdf';
import type { LanyardSettings as Settings, PhotoMarker } from '../../shared/schemas';
import { PHOTO_MARKERS } from '../../shared/schemas';
import { Button, Choice, Field, Icon, Notice, PageHeader, Section, Segmented, useConfirm, useToast } from '../ui';
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

/** Same limit as the server: big enough for a 300 dpi JPEG. */
const MAX_BYTES = 1400 * 1024;

const SAMPLE: Card = {
  registrationId: 'sample',
  name: 'Sam Taylor',
  kind: 'youth',
  section: 'Scouts',
  groupName: '1st Example Scout Group',
  shortCode: 'K7QM-3XRP',
  qr: 'https://campcount.com/c#sample-card-preview-only',
};

const fail = (err: unknown) => (err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Check uploaded artwork is the card's shape, and shrink a large PNG to a
 * JPEG so it fits. Returns a data URL, or throws a message for the person.
 */
async function prepareArtwork(file: File, size: CardSize): Promise<string> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') throw new Error('Choose a PNG or JPEG. Export it from your design software at the template size.');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That image couldn't be read.");
  const spec = CARD_SIZES[size];
  const want = spec.w / spec.h;
  const got = bitmap.width / bitmap.height;
  const px = artworkPixels(size);
  if (Math.abs(got - want) / want > 0.04) {
    throw new Error(`That image is the wrong shape for this card. Export it at ${spec.w} × ${spec.h} mm (${px.w} × ${px.h} pixels).`);
  }
  if (file.size <= MAX_BYTES) return readDataUrl(file);
  // Too big: redraw at 300 dpi as a JPEG.
  const canvas = document.createElement('canvas');
  canvas.width = px.w;
  canvas.height = px.h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, px.w, px.h);
  g.drawImage(bitmap, 0, 0, px.w, px.h);
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!jpeg || jpeg.size > MAX_BYTES) throw new Error('That image is too big. Save it as a JPEG under 1.4 MB.');
  return readDataUrl(jpeg);
}

/** Settings › Lanyards: the card design (built-in or the event's own artwork) and how missing photo consent shows. */
export function LanyardSettings() {
  const { event, can, reload, base } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const art = useLanyardArtwork(event.id, can('event.configure'));
  const [size, setSize] = useState<CardSize>('lanyard');
  const [value, setValue] = useState<Settings>(event.lanyard);
  const [failure, setFailure] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = { to: `${base}/settings`, label: 'Settings' };
  const editable = event.status === 'draft' || event.status === 'open';
  const dirty = JSON.stringify(value) !== JSON.stringify(event.lanyard);
  const kind = size === 'lanyard' ? 'lanyard' : 'wallet card';
  const px = artworkPixels(size);
  const spec = CARD_SIZES[size];

  if (!can('event.configure')) return <Navigate to={back.to} replace />;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await api(`/events/${event.id}`, { method: 'PATCH', body: { lanyard: value } });
      await reload();
      toast('Changes saved');
    } catch (err) {
      setFailure(fail(err));
    } finally {
      setBusy(false);
    }
  }

  async function upload(side: CardSide, file: File | undefined) {
    setUploadError(null);
    if (!file) return;
    try {
      const dataUrl = await prepareArtwork(file, size);
      await api(`/events/${event.id}/lanyard-templates/${size}/${side}`, { method: 'PUT', body: { dataUrl } });
      await art.reload();
      toast(`New ${side} artwork saved`);
    } catch (err) {
      setUploadError(err instanceof ApiFailure ? err.message : err instanceof Error ? err.message : 'Upload failed. Try again.');
    }
  }

  async function remove(side: CardSide) {
    const ok = await confirm({
      title: `Go back to the built-in ${side}?`,
      body: <p>Your uploaded {side} artwork for the {kind} is removed. You can upload it again any time.</p>,
      confirm: 'Use built-in design',
    });
    if (!ok) return;
    try {
      await api(`/events/${event.id}/lanyard-templates/${size}/${side}`, { method: 'DELETE' });
      await art.reload();
      toast('Back to the built-in design');
    } catch (err) {
      toast(fail(err), { tone: 'error' });
    }
  }

  const slug = size === 'lanyard' ? 'lanyard' : 'wallet-card';
  const sample = { ...SAMPLE, noPhotos: true };

  return (
    <>
      <PageHeader title="Lanyards" back={back} summary="Your card design, and how a card shows that someone has no photo consent." />
      <div className="sections">
        <Section title="Design" id="design">
          <p className="meta">
            Cards use the built-in design until you upload your own. Download the blank template, design on top of it in Canva, Illustrator or similar, hide the guides,
            then upload the result. CampCount prints each person's name, group, QR code, code and section on your front.
          </p>
          <Segmented
            label="Card size"
            value={size}
            onChange={(v) => {
              setSize(v);
              setUploadError(null);
            }}
            options={[
              { value: 'lanyard', label: 'Lanyard' },
              { value: 'badge', label: 'Wallet card' },
            ]}
          />
          <div className="template-download">
            <p>
              <strong>Blank {kind} template</strong>
              <span className="meta">
                {' '}
                {spec.w} × {spec.h} mm. Export your artwork at {px.w} × {px.h} pixels (300 dpi), PNG or JPEG.
              </span>
            </p>
            <div className="btn-row">
              <Button small busyLabel="Making…" onAction={async () => downloadPdf(await buildTemplatePdf(size), `campcount-${slug}-template.pdf`)}>
                <Icon name="download" />
                PDF (front and back)
              </Button>
              <Button small kind="ghost" busyLabel="Making…" onAction={async () => downloadBlob(await buildTemplatePng(size, 'front'), `campcount-${slug}-front.png`)}>
                PNG front
              </Button>
              <Button small kind="ghost" busyLabel="Making…" onAction={async () => downloadBlob(await buildTemplatePng(size, 'back'), `campcount-${slug}-back.png`)}>
                PNG back
              </Button>
            </div>
          </div>
          <p className="meta">The preview shows someone without photo consent, so you can see the marker on your design.</p>
          {uploadError && (
            <Notice tone="error">
              <p>{uploadError}</p>
            </Notice>
          )}
          <div className={`artwork-sides artwork-sides-${size}`}>
            {(['front', 'back'] as const).map((side) => {
              const url = art.url(size, side);
              const inputId = `art-${size}-${side}`;
              return (
                <div key={side} className="artwork-side">
                  <p className="artwork-side-head">
                    <strong>{side === 'front' ? 'Front' : 'Back'}</strong>
                    <span className="meta">{url ? 'Your artwork' : 'Built-in design'}</span>
                  </p>
                  {side === 'front' ? (
                    <LanyardCard card={sample} size={size} marker={value} artwork={url} printBand={value.printBand} />
                  ) : (
                    <LanyardBack card={sample} size={size} marker={value} eventName={event.name} logoUrl={event.logoUrl} artwork={url} />
                  )}
                  {editable && (
                    <div className="btn-row">
                      <label htmlFor={inputId} className="btn btn-secondary btn-small file-button">
                        <Icon name="plus" />
                        {url ? 'Replace' : 'Upload'}
                        <span className="visually-hidden"> {side} artwork</span>
                        <input
                          id={inputId}
                          type="file"
                          accept="image/png,image/jpeg"
                          className="visually-hidden"
                          onChange={(e) => {
                            void upload(side, e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {url && (
                        <Button small kind="ghost" onClick={() => void remove(side)}>
                          Use built-in
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <form className="form" onSubmit={save} noValidate>
          {failure && (
            <p className="field-error" role="alert">
              <Icon name="error" size={16} />
              {failure}
            </p>
          )}
          <fieldset className="form" disabled={!editable || busy}>
            <fieldset className="choices">
              <legend className="field-label">On your artwork</legend>
              <Choice
                label="Print the coloured section band"
                description="Green for Scouts, maroon for Venturers, red for Rovers, dark green for Leaders, across the top. Turn off if your artwork has its own band: the section word then prints on a small white tag."
                checked={value.printBand}
                onChange={(e) => setValue({ ...value, printBand: e.target.checked })}
              />
            </fieldset>
            <fieldset className="field">
              <legend className="field-label">No photo consent</legend>
              {!event.features.photo && <p className="meta">Photo consent is turned off for this event. Turn on Photos in Event details for these markers to print.</p>}
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
              <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…" disabled={!dirty}>
                Save changes
              </Button>
              {dirty && <Button onClick={() => setValue(event.lanyard)}>Undo changes</Button>}
            </div>
          )}
        </form>
      </div>
    </>
  );
}
