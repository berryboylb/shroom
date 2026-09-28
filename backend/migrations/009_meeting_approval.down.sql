DROP TABLE IF EXISTS room_join_requests;
ALTER TABLE rooms DROP COLUMN IF EXISTS approval_required;
ALTER TABLE rooms DROP COLUMN IF EXISTS host_identity;
