-- What each meal is (the menu) and what goes into it (ingredients), so
-- leaders can check them and participants can see whether their dietary
-- needs affect a meal from their own lanyard page.
ALTER TABLE meal_services ADD COLUMN menu TEXT NOT NULL DEFAULT '';
ALTER TABLE meal_services ADD COLUMN ingredients TEXT NOT NULL DEFAULT '';
