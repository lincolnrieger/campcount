/**
 * A person's role at a camp: a participant (youth) or a leader (adult).
 * It's the only thing about them besides their name and participant ID,
 * and sets the word and colour on their lanyard.
 */
export type Role = 'youth' | 'adult';

export const ROLE_LABEL: Record<Role, string> = { youth: 'Participant', adult: 'Leader' };

const ROLE_COLOUR: Record<Role, string> = { youth: '#1F6F8B', adult: '#262661' };

/** Readable text on a colour: near-black on light colours, white on dark ones. */
export function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.4 ? '#1A1A1A' : '#FFFFFF';
}

/** The lanyard word and colours for a role. */
export function roleStyle(kind: Role | string): { word: string; bg: string; fg: string } {
  const role: Role = kind === 'adult' ? 'adult' : 'youth';
  return { word: ROLE_LABEL[role], bg: ROLE_COLOUR[role], fg: textOn(ROLE_COLOUR[role]) };
}
