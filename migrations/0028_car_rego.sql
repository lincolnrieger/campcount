-- A leader's car registration, asked for the first time their lanyard is
-- scanned (e.g. when they collect it), so the camp knows whose car is whose.
-- car_rego_asked_at is set once asked, even if they skip.
ALTER TABLE registrations ADD COLUMN car_rego TEXT;
ALTER TABLE registrations ADD COLUMN car_rego_asked_at TEXT;
