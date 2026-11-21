import { describe, expect, it } from 'vitest';
import { suggestDietary } from '../src/shared/dietarySuggest';

const items = (...notes: string[]) => suggestDietary(...notes).map((e) => `${e.category}:${e.item}${e.severity === 'anaphylactic' ? '!' : ''}`);

describe('dietary suggestions from notes', () => {
  it('reads common needs and flags anaphylaxis', () => {
    expect(items('Peanut allergy, carries EpiPen')).toEqual(['allergy:Peanut!']);
    expect(items('Vegetarian')).toEqual(['preference:Vegetarian']);
    expect(items('Vegan', 'no pork')).toEqual(['preference:Vegan', 'religious_cultural:No pork']);
    expect(items('Coeliac - strictly gluten free')).toEqual(['medical_diet:Gluten free (coeliac)']);
    expect(items('lactose intolerant; tree nuts')).toEqual(['allergy:Tree nuts', 'intolerance:Lactose']);
    expect(items('Shellfish allergy')).toEqual(['allergy:Shellfish']);
  });
  it('says nothing for "nil" notes or nothing it knows', () => {
    expect(items('Nil', 'None')).toEqual([]);
    expect(items('Asthma, uses a puffer')).toEqual([]);
  });
});
