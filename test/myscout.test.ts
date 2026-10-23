import { describe, expect, it } from 'vitest';
import { parseDelimited } from '../src/shared/csv';
import { autoMap, deriveKind, flagDuplicates, missingRequired, prepareRows } from '../src/shared/myscout';

// Invented data shaped like a MyScout export. Never use real member data in tests.
const HEADER =
  'Role\tTeam\tStatus\tmember_number\tfirst_name\tpreferred_name\tlast_name\taddress_1\tbirth_date\tage_years\tposition\tformation\tmobile_number\temail\tmedicare_number\tmedical_conditions\tphoto_approval\tguardian_1_email';
const LEADER =
  'Leader/Rover\t\tcontact info confirmed\t900001\tAlex\tAl\tExample\t1 Fake St\t1/1/2000\t26\tAssistant Cub Scout Leader\tExampletown Cub Unit\t0400 000 000\talex@example.test\t1234567890\tVegetarian \tTRUE\tparent@example.test';
const CUB =
  'Participant\tRed Six\t\t900002\tJordan\t\tSample\t2 Fake St\t1/1/2016\t10\tCub Scout\tExampletown Cub Unit\t\t\t9876543210\t"Peanut allergy, carries EpiPen"\tFALSE\t';

describe('delimited parsing', () => {
  it('handles BOM, CRLF, quotes with commas, newlines and doubled quotes', () => {
    const text = '\uFEFFa,b,c\r\n1,"x, y","say ""hi"""\r\n2,"multi\nline",\r\n\r\n';
    const t = parseDelimited(text);
    expect(t.headers).toEqual(['a', 'b', 'c']);
    expect(t.rows).toEqual([
      ['1', 'x, y', 'say "hi"'],
      ['2', 'multi\nline', ''],
    ]);
  });

  it('detects tab-delimited MyScout pastes', () => {
    const t = parseDelimited(`${HEADER}\n${LEADER}\n${CUB}`);
    expect(t.delimiter).toBe('\t');
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]![15]).toBe('Peanut allergy, carries EpiPen');
  });
});

describe('MyScout mapping', () => {
  const table = parseDelimited(`${HEADER}\n${LEADER}\n${CUB}`);
  const mapping = autoMap(table.headers);

  it('maps the MyScout columns we need and nothing sensitive', () => {
    expect(missingRequired(mapping)).toEqual([]);
    const mappedHeaders = Object.values(mapping).map((i) => table.headers[i!]);
    for (const sensitive of ['address_1', 'birth_date', 'mobile_number', 'email', 'medicare_number', 'guardian_1_email']) {
      expect(mappedHeaders).not.toContain(sensitive);
    }
  });

  it('produces allowlisted rows with youth/adult, section and photo consent', () => {
    const [leader, cub] = prepareRows(table.rows, mapping);
    expect(leader!.row).toEqual({
      memberNumber: '900001',
      firstName: 'Alex',
      preferredName: 'Al',
      lastName: 'Example',
      kind: 'adult',
      section: 'Leaders',
      groupName: 'Exampletown Cub Unit',
      position: 'Assistant Cub Scout Leader',
      roleLabel: 'Leader/Rover',
      team: '',
      sourceStatus: 'contact info confirmed',
      photoConsent: 'yes',
    });
    expect(cub!.row).toMatchObject({ kind: 'youth', section: 'Cubs', team: 'Red Six', photoConsent: 'no' });
    expect(cub!.dietaryText).toBe('Peanut allergy, carries EpiPen');
    // No sensitive value leaks into the row sent to the server.
    const serialised = JSON.stringify([leader!.row, cub!.row]);
    for (const s of ['1234567890', 'Fake St', 'example.test', 'EpiPen', '2016']) expect(serialised).not.toContain(s);
  });

  it('uses age before role words to decide youth or adult', () => {
    expect(deriveKind('Participant', '', '19')).toBe('adult');
    expect(deriveKind('Leader/Rover', '', '17')).toBe('youth');
    expect(deriveKind('Leader/Rover', '', '')).toBe('adult');
    expect(deriveKind('', 'Cub Scout', '')).toBe('youth');
  });

  it('flags missing and duplicate membership numbers', () => {
    const rows = prepareRows(
      [
        ['', '', '', '', 'A', '', 'B'],
        ['', '', '', '700', 'C', '', 'D'],
        ['', '', '', '700', 'E', '', 'F'],
      ],
      { memberNumber: 3, firstName: 4, lastName: 6 },
    );
    flagDuplicates(rows);
    expect(rows[0]!.errors).toContain('Membership number is missing');
    expect(rows[1]!.errors).toEqual([]);
    expect(rows[2]!.errors).toContain('Same membership number as line 3');
  });
});
