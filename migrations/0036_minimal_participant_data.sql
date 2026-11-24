-- Keep as little about participants as possible, in plain terms.
--
-- * Participant ID (was membership number) and Level (was section).
-- * A keyed hash of each participant ID (participant_key), so people can be
--   found once the ID itself is encrypted. The Worker fills it in and
--   encrypts existing names, IDs, groups, levels, car registrations,
--   dietary details and typed lanyard codes the first time it runs after this
--   migration (see src/worker/services/sealExisting.ts).
-- * Removed: preferred names, positions, role and status labels, team labels
--   and extra imported columns (which could hold medication or swimming
--   details). Only first name, last name, group, level, participant ID,
--   photo consent and dietary needs remain.
-- * Photo consent is Yes or No: anything not clearly Yes is No.

-- people
ALTER TABLE people RENAME COLUMN member_number TO participant_id;
ALTER TABLE people ADD COLUMN participant_key TEXT;
CREATE UNIQUE INDEX people_participant_key ON people (participant_key) WHERE participant_key IS NOT NULL;
ALTER TABLE people DROP COLUMN preferred_name;

-- registrations
ALTER TABLE registrations RENAME COLUMN section TO level;
ALTER TABLE registrations DROP COLUMN position;
ALTER TABLE registrations DROP COLUMN role_label;
ALTER TABLE registrations DROP COLUMN team;
ALTER TABLE registrations DROP COLUMN source_status;
ALTER TABLE registrations DROP COLUMN extra_fields;
UPDATE registrations SET photo_consent = 'no' WHERE photo_consent <> 'yes';

-- credentials: the typed code is encrypted; this keyed hash finds it.
ALTER TABLE credentials ADD COLUMN short_code_key TEXT;
CREATE UNIQUE INDEX credentials_short_code_key ON credentials (event_id, short_code_key) WHERE short_code_key IS NOT NULL;

-- events: levels are the camp's own. Camps that never saved a list keep
-- the names their people are already filed under.
ALTER TABLE events RENAME COLUMN youth_sections TO youth_levels;
ALTER TABLE events RENAME COLUMN section_settings TO level_settings;
UPDATE events
   SET level_settings = (
         SELECT json_group_array(json_object('name', lvl, 'word', lvl, 'colour', '#5A6770', 'youth', json('true')))
           FROM (SELECT DISTINCT level AS lvl FROM registrations WHERE event_id = events.id AND level <> '' ORDER BY level))
 WHERE level_settings IS NULL
   AND EXISTS (SELECT 1 FROM registrations WHERE event_id = events.id AND level <> '');

-- Imports no longer record the file's name.
UPDATE import_jobs SET source_label = '';
