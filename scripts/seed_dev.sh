#!/bin/bash
echo "Seeding dev database..."
# Simple seed to ensure basic records exist for testing
psql "postgres://postgres:postgres@localhost:5433/shroom?sslmode=disable" -c "
INSERT INTO users (id, email, display_name, password_hash) 
VALUES ('11111111-1111-1111-1111-111111111111', 'test@shroom.local', 'Test User', 'hashedpassword')
ON CONFLICT (email) DO NOTHING;
"
echo "Dev db seeded."
