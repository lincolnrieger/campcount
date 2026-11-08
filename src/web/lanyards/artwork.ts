import { useApi } from '../useApi';
import type { Artwork, CardSide, CardSize } from './pdf';

export interface ArtworkEntry {
  size: CardSize;
  side: CardSide;
  url: string;
}

/** The event's uploaded lanyard artwork (none means the built-in design). */
export function useLanyardArtwork(eventId: string, enabled = true) {
  const { data, reload, loading } = useApi<{ templates: ArtworkEntry[] }>(enabled ? `/events/${eventId}/lanyard-templates` : null);
  const list = data?.templates ?? [];
  return {
    loading: enabled && loading && !data,
    reload,
    url: (size: CardSize, side: CardSide) => list.find((t) => t.size === size && t.side === side)?.url ?? null,
  };
}

/** Fetch artwork for the PDF builder. Null if there isn't any or it won't load. */
export async function loadArtwork(url: string | null): Promise<Artwork | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const type = res.headers.get('Content-Type');
    if (type !== 'image/png' && type !== 'image/jpeg') return null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), type };
  } catch {
    return null;
  }
}
