-- Each lanyard's typed code becomes the person's participant ID
-- (the QR code doesn't change). Guests, who have no participant ID, keep
-- their random code. A code is only changed if no other card at the camp
-- already uses that number.
UPDATE credentials
   SET short_code = (
         SELECT upper(replace(replace(p.member_number, '-', ''), ' ', ''))
           FROM registrations r JOIN people p ON p.id = r.person_id
          WHERE r.id = credentials.registration_id)
 WHERE status = 'active'
   AND EXISTS (
         SELECT 1 FROM registrations r JOIN people p ON p.id = r.person_id
          WHERE r.id = credentials.registration_id
            AND p.member_number NOT LIKE 'GUEST-%'
            AND length(replace(replace(p.member_number, '-', ''), ' ', '')) BETWEEN 3 AND 20)
   AND NOT EXISTS (
         SELECT 1 FROM credentials o
          WHERE o.event_id = credentials.event_id AND o.id <> credentials.id
            AND o.short_code = (
                  SELECT upper(replace(replace(p.member_number, '-', ''), ' ', ''))
                    FROM registrations r JOIN people p ON p.id = r.person_id
                   WHERE r.id = credentials.registration_id));
