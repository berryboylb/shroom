-- Return one word for the deploy script. This is deliberately strict before
-- baselining a database that has tables but no schema_migrations history.
SELECT CASE WHEN
    to_regclass('public.users') IS NOT NULL
    AND to_regclass('public.rooms') IS NOT NULL
    AND to_regclass('public.room_participants') IS NOT NULL
    AND to_regclass('public.call_sessions') IS NOT NULL
    AND to_regclass('public.call_quality_snapshots') IS NOT NULL
    AND to_regclass('public.call_quality_snapshots_2026_08') IS NOT NULL
    AND to_regclass('public.refresh_tokens') IS NOT NULL
    AND to_regclass('public.auth_identities') IS NOT NULL
    AND to_regclass('public.room_join_requests') IS NOT NULL
    AND to_regclass('public.post_call_feedback') IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM (VALUES
            ('users', 'id'), ('users', 'email'), ('users', 'display_name'),
            ('users', 'avatar_url'), ('users', 'password_hash'), ('users', 'created_at'),
            ('users', 'updated_at'), ('users', 'last_seen_at'), ('users', 'status'),
            ('rooms', 'id'), ('rooms', 'owner_id'), ('rooms', 'title'),
            ('rooms', 'type'), ('rooms', 'status'), ('rooms', 'max_participants'),
            ('rooms', 'settings'), ('rooms', 'created_at'), ('rooms', 'updated_at'),
            ('rooms', 'ended_at'), ('rooms', 'host_identity'), ('rooms', 'approval_required'),
            ('room_participants', 'id'), ('room_participants', 'room_id'),
            ('room_participants', 'user_id'), ('room_participants', 'display_name'),
            ('room_participants', 'role'), ('room_participants', 'joined_at'),
            ('room_participants', 'left_at'), ('room_participants', 'join_count'),
            ('call_sessions', 'id'), ('call_sessions', 'room_id'),
            ('call_sessions', 'started_at'), ('call_sessions', 'ended_at'),
            ('call_sessions', 'participant_count'), ('call_sessions', 'duration_seconds'),
            ('call_sessions', 'quality_summary'),
            ('call_quality_snapshots', 'id'), ('call_quality_snapshots', 'session_id'),
            ('call_quality_snapshots', 'participant_id'), ('call_quality_snapshots', 'timestamp'),
            ('call_quality_snapshots', 'metrics'),
            ('refresh_tokens', 'id'), ('refresh_tokens', 'user_id'),
            ('refresh_tokens', 'token_hash'), ('refresh_tokens', 'expires_at'),
            ('refresh_tokens', 'created_at'), ('refresh_tokens', 'revoked_at'),
            ('auth_identities', 'id'), ('auth_identities', 'user_id'),
            ('auth_identities', 'provider'), ('auth_identities', 'provider_subject'),
            ('auth_identities', 'created_at'),
            ('room_join_requests', 'room_id'), ('room_join_requests', 'participant_id'),
            ('room_join_requests', 'display_name'), ('room_join_requests', 'status'),
            ('room_join_requests', 'requested_at'), ('room_join_requests', 'decided_at'),
            ('post_call_feedback', 'id'), ('post_call_feedback', 'room_id'),
            ('post_call_feedback', 'participant_id'), ('post_call_feedback', 'rating'),
            ('post_call_feedback', 'issue'), ('post_call_feedback', 'note'),
            ('post_call_feedback', 'created_at')
        ) AS required(table_name, column_name)
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns actual
            WHERE actual.table_schema = 'public'
              AND actual.table_name = required.table_name
              AND actual.column_name = required.column_name
        )
    )
    AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'id'
          AND character_maximum_length = 20
    )
    AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'host_identity'
    )
    AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'approval_required'
          AND data_type = 'boolean' AND is_nullable = 'NO'
    )
    AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_hash'
          AND is_nullable = 'YES'
    )
    AND EXISTS (
        SELECT 1 FROM pg_class index_table
        JOIN pg_index index_details ON index_details.indexrelid = index_table.oid
        WHERE index_table.relname = 'idx_refresh_tokens_token_hash'
          AND index_details.indisunique
    )
    AND EXISTS (
        SELECT 1 FROM pg_constraint constraint_details
        JOIN pg_class table_details ON table_details.oid = constraint_details.conrelid
        WHERE table_details.relname = 'auth_identities'
          AND constraint_details.contype = 'u'
          AND pg_get_constraintdef(constraint_details.oid) = 'UNIQUE (provider, provider_subject)'
    )
    AND EXISTS (
        SELECT 1 FROM pg_constraint constraint_details
        JOIN pg_class table_details ON table_details.oid = constraint_details.conrelid
        WHERE table_details.relname = 'auth_identities'
          AND constraint_details.contype = 'u'
          AND pg_get_constraintdef(constraint_details.oid) = 'UNIQUE (user_id, provider)'
    )
    AND EXISTS (
        SELECT 1 FROM pg_constraint constraint_details
        JOIN pg_class table_details ON table_details.oid = constraint_details.conrelid
        WHERE table_details.relname = 'room_join_requests'
          AND constraint_details.contype = 'p'
          AND pg_get_constraintdef(constraint_details.oid) = 'PRIMARY KEY (room_id, participant_id)'
    )
    AND NOT EXISTS (
        SELECT 1 FROM (VALUES
            ('idx_users_email'), ('idx_rooms_owner_id'), ('idx_rooms_status'),
            ('idx_room_participants_room_id'), ('idx_room_participants_user_id'),
            ('idx_room_participants_active'), ('idx_call_sessions_room_id'),
            ('idx_call_sessions_started_at'), ('idx_refresh_tokens_user_id'),
            ('idx_refresh_tokens_expires_at'), ('idx_auth_identities_user_id'),
            ('idx_refresh_tokens_token_hash'), ('idx_room_join_requests_pending'),
            ('idx_post_call_feedback_created_at')
        ) AS required(index_name)
        WHERE to_regclass('public.' || required.index_name) IS NULL
    )
    THEN 'ready' ELSE 'incomplete' END;
