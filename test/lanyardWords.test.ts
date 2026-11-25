import { describe, expect, it } from 'vitest';
import { LEVEL_COLOURS, fillFields, levelWord } from '../src/shared/lanyardDesign';

describe('lanyard words', () => {
  it('prints Leader for adults and Participant for everyone else', () => {
    expect(levelWord('adult')).toBe('Leader');
    expect(levelWord('youth')).toBe('Participant');
    expect(LEVEL_COLOURS.Leader!.bg).toBe('#262661');
  });

  it('uses the role word the card carries', () => {
    const person = { name: 'A B', kind: 'adult' as const, shortCode: '1', qr: 'x', style: { word: 'Leader', bg: '#262661', fg: '#FFFFFF' } };
    expect(fillFields('{level}', person, 'Camp')).toBe('Leader');
  });

  it('prints the first name with the last name (or initial), and no group', () => {
    const person = { name: 'Sam van der Berg', firstName: 'Sam', lastName: 'van der Berg', kind: 'youth' as const, shortCode: '123456', qr: 'x' };
    expect(fillFields('{name}|{first}|{last}|{group}|{level}', person, 'Camp')).toBe('Sam van der Berg|Sam|van der Berg||Participant');
  });
});
