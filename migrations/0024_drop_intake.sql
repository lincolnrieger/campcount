-- Import & check no longer keeps anything about uploaded files on the
-- server: the files, and which people have been checked, stay in the
-- browser of the person importing. Remove what the earlier version kept.
DROP TABLE IF EXISTS intake_checks;
DROP TABLE IF EXISTS intake_sightings;
