/**
 * The fonts a lanyard design can use, self-hosted from @fontsource (latin).
 * WOFF2 for drawing on screen, WOFF for embedding in PDFs. Each file is only
 * fetched when a design uses it.
 */
import type { FontId, FontWeight } from '../../shared/lanyardDesign';
import { FONTS, fontWeight } from '../../shared/lanyardDesign';
import nunito_sans_400_woff2 from '@fontsource/nunito-sans/files/nunito-sans-latin-400-normal.woff2?url';
import nunito_sans_400_woff from '@fontsource/nunito-sans/files/nunito-sans-latin-400-normal.woff?url';
import nunito_sans_700_woff2 from '@fontsource/nunito-sans/files/nunito-sans-latin-700-normal.woff2?url';
import nunito_sans_700_woff from '@fontsource/nunito-sans/files/nunito-sans-latin-700-normal.woff?url';
import nunito_sans_800_woff2 from '@fontsource/nunito-sans/files/nunito-sans-latin-800-normal.woff2?url';
import nunito_sans_800_woff from '@fontsource/nunito-sans/files/nunito-sans-latin-800-normal.woff?url';
import merriweather_400_woff2 from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff2?url';
import merriweather_400_woff from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff?url';
import merriweather_700_woff2 from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff2?url';
import merriweather_700_woff from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff?url';
import roboto_slab_400_woff2 from '@fontsource/roboto-slab/files/roboto-slab-latin-400-normal.woff2?url';
import roboto_slab_400_woff from '@fontsource/roboto-slab/files/roboto-slab-latin-400-normal.woff?url';
import roboto_slab_700_woff2 from '@fontsource/roboto-slab/files/roboto-slab-latin-700-normal.woff2?url';
import roboto_slab_700_woff from '@fontsource/roboto-slab/files/roboto-slab-latin-700-normal.woff?url';
import oswald_400_woff2 from '@fontsource/oswald/files/oswald-latin-400-normal.woff2?url';
import oswald_400_woff from '@fontsource/oswald/files/oswald-latin-400-normal.woff?url';
import oswald_700_woff2 from '@fontsource/oswald/files/oswald-latin-700-normal.woff2?url';
import oswald_700_woff from '@fontsource/oswald/files/oswald-latin-700-normal.woff?url';
import bebas_neue_400_woff2 from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url';
import bebas_neue_400_woff from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?url';
import permanent_marker_400_woff2 from '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2?url';
import permanent_marker_400_woff from '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff?url';

const FILES: Record<string, { woff2: string; woff: string }> = {
  'nunito-sans:400': { woff2: nunito_sans_400_woff2, woff: nunito_sans_400_woff },
  'nunito-sans:700': { woff2: nunito_sans_700_woff2, woff: nunito_sans_700_woff },
  'nunito-sans:800': { woff2: nunito_sans_800_woff2, woff: nunito_sans_800_woff },
  'merriweather:400': { woff2: merriweather_400_woff2, woff: merriweather_400_woff },
  'merriweather:700': { woff2: merriweather_700_woff2, woff: merriweather_700_woff },
  'roboto-slab:400': { woff2: roboto_slab_400_woff2, woff: roboto_slab_400_woff },
  'roboto-slab:700': { woff2: roboto_slab_700_woff2, woff: roboto_slab_700_woff },
  'oswald:400': { woff2: oswald_400_woff2, woff: oswald_400_woff },
  'oswald:700': { woff2: oswald_700_woff2, woff: oswald_700_woff },
  'bebas-neue:400': { woff2: bebas_neue_400_woff2, woff: bebas_neue_400_woff },
  'permanent-marker:400': { woff2: permanent_marker_400_woff2, woff: permanent_marker_400_woff },
};

function files(font: FontId, weight: FontWeight) {
  return FILES[`${font}:${fontWeight(font, weight)}`]!;
}

const loaded = new Map<string, Promise<void>>();

/** Make a font usable on canvases (registers it with the page). */
export function loadFont(font: FontId, weight: FontWeight): Promise<void> {
  const w = fontWeight(font, weight);
  const key = `${font}:${w}`;
  let p = loaded.get(key);
  if (!p) {
    const face = new FontFace(FONTS[font].family, `url(${files(font, w).woff2}) format('woff2')`, { weight: String(w) });
    p = face.load().then(
      (f) => {
        document.fonts.add(f);
      },
      () => {
        loaded.delete(key);
      },
    );
    loaded.set(key, p);
  }
  return p;
}

/** Load every font and weight a list of text styles needs. */
export async function loadFonts(styles: { font: FontId; weight: FontWeight }[]): Promise<void> {
  await Promise.all(styles.map((s) => loadFont(s.font, s.weight)));
}

const bytes = new Map<string, Promise<Uint8Array>>();

/** The font file for a PDF. */
export function fontBytes(font: FontId, weight: FontWeight): Promise<Uint8Array> {
  const f = files(font, weight);
  let p = bytes.get(f.woff);
  if (!p) {
    p = fetch(f.woff).then(async (r) => {
      if (!r.ok) throw new Error('font');
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => bytes.delete(f.woff));
    bytes.set(f.woff, p);
  }
  return p;
}

/** CSS font shorthand for a canvas, size in pixels. */
export function canvasFont(font: FontId, weight: FontWeight, px: number): string {
  return `${fontWeight(font, weight)} ${px}px "${FONTS[font].family}", sans-serif`;
}
