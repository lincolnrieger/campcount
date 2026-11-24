import { describe, expect, it } from 'vitest';
import { LEVEL_COLOURS, fillFields, levelWord } from '../src/shared/lanyardDesign';

describe('lanyard words', () => {
  it('falls back to Leader for adults and Participant for everyone else, when the camp has no word', () => {
    expect(levelWord('adult', 'Leaders')).toBe('Leader');
    expect(levelWord('adult', 'Seniors')).toBe('Leader');
    expect(levelWord('youth', 'Juniors')).toBe('Participant');
    expect(LEVEL_COLOURS.Leader!.bg).toBe('#262661');
  });

  it("uses the camp's own word for the level when it has one", () => {
    const person = { name: 'A B', kind: 'youth' as const, level: 'Juniors', groupName: '', shortCode: '1', qr: 'x', style: { word: 'Junior', bg: '#000000', fg: '#FFFFFF' } };
    expect(fillFields('{level}', person, 'Camp')).toBe('Junior');
  });

  it('prints the first name with the last name (or initial), and no group', () => {
    const person = { name: 'Sam van der Berg', firstName: 'Sam', lastName: 'van der Berg', kind: 'youth' as const, level: 'Seniors', groupName: '1st Somewhere', shortCode: '123456', qr: 'x' };
    expect(fillFields('{name}|{first}|{last}|{group}|{level}', person, 'Camp')).toBe('Sam van der Berg|Sam|van der Berg||Participant');
  });
});
