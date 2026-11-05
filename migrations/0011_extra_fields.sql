-- Extra columns an event manager chose to keep from an import (Team, patrol, bus, tent…),
-- as a JSON object of { "column name": "value" }.
ALTER TABLE registrations ADD COLUMN extra_fields TEXT NOT NULL DEFAULT '{}';
