import { describe, expect, it } from 'vitest';
import { SECTION_COLOURS, fillFields, sectionWord } from '../src/shared/lanyardDesign';

describe('lanyard words', () => {
  it('says Leader for adults, the section for Joeys to Rovers, and nothing for anyone else', () => {
    expect(sectionWord('adult', 'Leaders')).toBe('Leader');
    expect(sectionWord('adult', 'Scouts')).toBe('Leader');
    expect(sectionWord('youth', 'Joeys')).toBe('Joey');
    expect(sectionWord('youth', 'Cubs')).toBe('Cub');
    expect(sectionWord('youth', 'Scouts')).toBe('Scout');
    expect(sectionWord('youth', 'Venturers')).toBe('Venturer');
    expect(sectionWord('youth', 'Rovers')).toBe('Rover');
    expect(sectionWord('adult', 'Rovers')).toBe('Rover');
    expect(sectionWord('youth', 'Other')).toBe('');
    expect(fillFields('{section}', { name: 'A B', kind: 'youth', section: 'Other', groupName: '', shortCode: '1', qr: 'x' }, 'Camp')).toBe('');
    expect(SECTION_COLOURS.Leader!.bg).toBe('#262661');
  });

  it('prints the preferred name with the full surname, and no group', () => {
    const person = { name: 'Sam van der Berg', firstName: 'Sam', lastName: 'van der Berg', kind: 'youth' as const, section: 'Scouts', groupName: '1st Somewhere', shortCode: '123456', qr: 'x' };
    expect(fillFields('{name}|{first}|{last}|{group}|{section}', person, 'Camp')).toBe('Sam van der Berg|Sam|van der Berg||Scout');
  });
});
