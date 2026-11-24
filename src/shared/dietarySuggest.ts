import type { DietaryEntryInput } from './schemas';
import { saysNothing } from './importFields';

/**
 * Suggested dietary entries from free-text notes ("Peanut allergy, carries
 * EpiPen", "Vegetarian", "No pork"). Only a starting point: the person
 * checking reads the notes and confirms or changes them.
 */
const RULES: { re: RegExp; entry: Omit<DietaryEntryInput, 'severity' | 'note'> }[] = [
  { re: /\bpea\s?nuts?\b/i, entry: { category: 'allergy', item: 'Peanut' } },
  { re: /\btree\s?nuts?\b|\b(almond|cashew|walnut|pecan|hazelnut|pistachio|macadamia)s?\b|\bnuts?\b(?!.*\bpea\s?nut)/i, entry: { category: 'allergy', item: 'Tree nuts' } },
  { re: /\beggs?\b/i, entry: { category: 'allergy', item: 'Egg' } },
  { re: /\bsesame\b/i, entry: { category: 'allergy', item: 'Sesame' } },
  { re: /\bsoy|soya\b/i, entry: { category: 'allergy', item: 'Soy' } },
  { re: /\bshell\s?fish|prawns?|crustacean/i, entry: { category: 'allergy', item: 'Shellfish' } },
  { re: /\bfish\b/i, entry: { category: 'allergy', item: 'Fish' } },
  { re: /\bcoeliac|celiac\b/i, entry: { category: 'medical_diet', item: 'Gluten free (coeliac)' } },
  { re: /\bgluten\b/i, entry: { category: 'intolerance', item: 'Gluten' } },
  { re: /\blactose\b/i, entry: { category: 'intolerance', item: 'Lactose' } },
  { re: /\bdairy\b|\bmilk\b/i, entry: { category: 'intolerance', item: 'Dairy' } },
  { re: /\bvegan\b/i, entry: { category: 'preference', item: 'Vegan' } },
  { re: /\bvegetarian\b|\bveggie\b/i, entry: { category: 'preference', item: 'Vegetarian' } },
  { re: /\bpescatarian\b/i, entry: { category: 'preference', item: 'Pescatarian' } },
  { re: /\bhalal\b/i, entry: { category: 'religious_cultural', item: 'Halal' } },
  { re: /\bkosher\b/i, entry: { category: 'religious_cultural', item: 'Kosher' } },
  { re: /\bno pork\b|\bpork\b/i, entry: { category: 'religious_cultural', item: 'No pork' } },
  { re: /\bno beef\b|\bbeef\b/i, entry: { category: 'religious_cultural', item: 'No beef' } },
  { re: /\bdiabet/i, entry: { category: 'medical_diet', item: 'Diabetic' } },
];

const ANAPHYLACTIC = /anaphyla|epi\s?-?pen|anapen|adrenaline/i;

export function suggestDietary(...notes: string[]): DietaryEntryInput[] {
  const text = notes.filter((n) => n.trim() && !saysNothing(n)).join('\n');
  if (!text) return [];
  // "Vegan" also says vegetarian; "coeliac" also says gluten.
  const out: DietaryEntryInput[] = [];
  for (const r of RULES) {
    if (!r.re.test(text)) continue;
    if (r.entry.item === 'Vegetarian' && out.some((e) => e.item === 'Vegan')) continue;
    if (r.entry.item === 'Gluten' && out.some((e) => e.item.startsWith('Gluten free'))) continue;
    // A fish allergy is only "fish" when it isn't about shellfish.
    if (r.entry.item === 'Fish' && /shell\s?fish/i.test(text) && !/\bfish\b(?!\s*shell)/i.test(text.replace(/shell\s?fish/gi, ''))) continue;
    out.push({ ...r.entry, severity: r.entry.category === 'allergy' && ANAPHYLACTIC.test(text) ? 'anaphylactic' : 'standard', note: '' });
  }
  return out;
}
