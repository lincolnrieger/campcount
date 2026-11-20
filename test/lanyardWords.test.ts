import { describe, expect, it } from 'vitest';
import { SECTION_COLOURS, fillFields, sectionWord } from '../src/shared/lanyardDesign';

describe('lanyard words', () => {
  it('only says Scout, Venturer or Adult', () => {
    expect(sectionWord('youth', 'Joeys')).toBe('Scout');
    expect(sectionWord('youth', 'Scouts')).toBe('Scout');
    expect(sectionWord('youth', 'Venturers')).toBe('Venturer');
    expect(sectionWord('youth', 'Rovers')).toBe('Adult');
    expect(sectionWord('adult', 'Leaders')).toBe('Adult');
    expect(SECTION_COLOURS.Adult!.bg).toBe('#262661');
  });

  it('prints the preferred name with the full surname, and no group', () => {
    const person = { name: 'Sam van der Berg', firstName: 'Sam', lastName: 'van der Berg', kind: 'youth' as const, section: 'Scouts', groupName: '1st Somewhere', shortCode: '123456', qr: 'x' };
    expect(fillFields('{name}|{first}|{last}|{group}|{section}', person, 'Camp')).toBe('Sam van der Berg|Sam|van der Berg||Scout');
  });
});
