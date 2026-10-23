-- Task list schema, row-level security, and transactional CSV import.
-- Apply this file to a clean Supabase/PostgreSQL database.
-- The application never uses the service-role key. Ownership is auth.uid().
-- gen_random_uuid() is built into PostgreSQL 13+ and does not need pgcrypto.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOINHERIT;
  END IF;
END
$$;

-- Hosted Supabase already owns auth.users and auth.uid(). Creating them there is denied.
-- This stub runs only on a local database where those objects are missing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    INNER JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'auth'
      AND relation.relname = 'users'
      AND relation.relkind = 'r'
  ) THEN
    RETURN;
  END IF;

  CREATE SCHEMA IF NOT EXISTS auth;

  CREATE FUNCTION auth.uid()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  AS $fn$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  $fn$;

  CREATE TABLE auth.users (
    id uuid PRIMARY KEY
  );

  GRANT USAGE ON SCHEMA auth TO authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
END
$$;

-- ASCII case-fold plus the same surrounding whitespace removed by the app.
-- Marked immutable so the unique index can use it. COLLATE "C" keeps lower() deterministic.
CREATE OR REPLACE FUNCTION public.normalize_task_title(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT lower(btrim(coalesce(value, ''), E' \t\n\r\f\v') COLLATE "C");
$$;

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL,
  notes text,
  due_date date NOT NULL,
  priority integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT tasks_title_length CHECK (
    char_length(title) BETWEEN 1 AND 200
    AND char_length(btrim(title, E' \t\n\r\f\v')) >= 1
  ),
  CONSTRAINT tasks_notes_length CHECK (notes IS NULL OR char_length(notes) <= 5000),
  CONSTRAINT tasks_priority_range CHECK (priority BETWEEN 1 AND 5),
  CONSTRAINT tasks_status_value CHECK (status IN ('pending', 'completed'))
);

CREATE INDEX IF NOT EXISTS tasks_user_active_due_idx
  ON public.tasks (user_id, due_date, created_at, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tasks_user_active_status_idx
  ON public.tasks (user_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tasks_user_active_priority_idx
  ON public.tasks (user_id, priority)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_active_normalized_unique
  ON public.tasks (user_id, public.normalize_task_title(title), due_date)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.tasks_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id cannot be changed' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_before_update ON public.tasks;
CREATE TRIGGER tasks_before_update
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.tasks_before_update();

-- The DELETE policy is the ownership check. This trigger rejects the actual
-- removal so application users can only soft-delete by setting deleted_at.
CREATE OR REPLACE FUNCTION public.prevent_task_physical_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'physical deletion is not allowed' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS tasks_no_physical_delete ON public.tasks;
CREATE TRIGGER tasks_no_physical_delete
  BEFORE DELETE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_task_physical_delete();

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks FORCE ROW LEVEL SECURITY;

-- PostgreSQL also checks SELECT policies against the new version of an updated row.
-- A SELECT policy that hides deleted_at rows would reject the soft-delete update itself.
-- Tenant isolation stays in this policy. Active-list filtering is in list_my_tasks and the app.
DROP POLICY IF EXISTS tasks_select_own ON public.tasks;
CREATE POLICY tasks_select_own
  ON public.tasks
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS tasks_insert_own ON public.tasks;
CREATE POLICY tasks_insert_own
  ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND deleted_at IS NULL);

DROP POLICY IF EXISTS tasks_update_own ON public.tasks;
CREATE POLICY tasks_update_own
  ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS tasks_delete_own ON public.tasks;
CREATE POLICY tasks_delete_own
  ON public.tasks
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.tasks FROM PUBLIC;
REVOKE ALL ON TABLE public.tasks FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tasks TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_tasks(
  p_query text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_priority integer DEFAULT NULL,
  p_due text DEFAULT NULL,
  p_today date DEFAULT CURRENT_DATE
)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_query text := NULLIF(btrim(coalesce(p_query, '')), '');
  v_pattern text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'completed') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;

  IF p_due IS NOT NULL AND p_due NOT IN ('overdue', 'today', 'upcoming') THEN
    RAISE EXCEPTION 'invalid due filter' USING ERRCODE = '22023';
  END IF;

  IF p_priority IS NOT NULL AND (p_priority < 1 OR p_priority > 5) THEN
    RAISE EXCEPTION 'invalid priority' USING ERRCODE = '22023';
  END IF;

  IF v_query IS NOT NULL AND char_length(v_query) > 200 THEN
    RAISE EXCEPTION 'search is too long' USING ERRCODE = '22023';
  END IF;

  IF v_query IS NULL THEN
    v_pattern := NULL;
  ELSE
    v_pattern :=
      '%' ||
      replace(replace(replace(v_query, chr(92), chr(92) || chr(92)), '%', '\%'), '_', '\_') ||
      '%';
  END IF;

  RETURN QUERY
  SELECT tasks.*
  FROM public.tasks AS tasks
  WHERE tasks.deleted_at IS NULL
    AND tasks.user_id = auth.uid()
    AND (p_status IS NULL OR tasks.status = p_status)
    AND (p_priority IS NULL OR tasks.priority = p_priority)
    AND (
      p_due IS NULL
      OR (p_due = 'overdue' AND tasks.status = 'pending' AND tasks.due_date < p_today)
      OR (p_due = 'today' AND tasks.due_date = p_today)
      OR (p_due = 'upcoming' AND tasks.due_date > p_today)
    )
    AND (
      v_pattern IS NULL
      OR tasks.title ILIKE v_pattern ESCAPE '\'
      OR coalesce(tasks.notes, '') ILIKE v_pattern ESCAPE '\'
    )
  ORDER BY tasks.due_date ASC, tasks.created_at ASC, tasks.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_tasks(text, text, integer, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_tasks(text, text, integer, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_my_tasks(text, text, integer, text, date) TO authenticated;

-- Inserts every accepted candidate or inserts none.
-- candidates is a JSON array of {title, due_date, priority, notes}. user_id is ignored.
CREATE OR REPLACE FUNCTION public.import_tasks(candidates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_title text;
  v_notes text;
  v_due date;
  v_priority integer;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_seen text[] := '{}';
  v_key text;
  v_index integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF candidates IS NULL OR jsonb_typeof(candidates) <> 'array' THEN
    RAISE EXCEPTION 'candidates must be a JSON array' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(candidates) > 1000 THEN
    RAISE EXCEPTION 'too many rows' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text));

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(candidates)
  LOOP
    v_index := v_index + 1;

    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'invalid candidate at position %', v_index USING ERRCODE = '22023';
    END IF;

    v_title := btrim(coalesce(v_item->>'title', ''), E' \t\n\r\f\v');
    v_notes := NULLIF(btrim(coalesce(v_item->>'notes', ''), E' \t\n\r\f\v'), '');

    IF v_title = '' OR char_length(v_title) > 200 THEN
      RAISE EXCEPTION 'invalid title at position %', v_index USING ERRCODE = '22023';
    END IF;

    IF coalesce(v_item->>'due_date', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'invalid due_date at position %', v_index USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_due := (v_item->>'due_date')::date;
    EXCEPTION
      WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION 'invalid due_date at position %', v_index USING ERRCODE = '22023';
    END;

    IF coalesce(v_item->>'priority', '') !~ '^[1-5]$' THEN
      RAISE EXCEPTION 'invalid priority at position %', v_index USING ERRCODE = '22023';
    END IF;

    v_priority := (v_item->>'priority')::integer;
    v_key := public.normalize_task_title(v_title) || '|' || v_due::text;

    IF v_key = ANY (v_seen) OR EXISTS (
      SELECT 1
      FROM public.tasks
      WHERE user_id = v_uid
        AND deleted_at IS NULL
        AND public.normalize_task_title(title) = public.normalize_task_title(v_title)
        AND due_date = v_due
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'duplicate active task; import rolled back' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.tasks (user_id, title, notes, due_date, priority, status)
    VALUES (v_uid, v_title, v_notes, v_due, v_priority, 'pending')
    RETURNING id INTO v_id;

    v_ids := array_append(v_ids, v_id);
    v_seen := array_append(v_seen, v_key);
  END LOOP;

  RETURN jsonb_build_object(
    'inserted_count', coalesce(cardinality(v_ids), 0),
    'inserted_ids', coalesce(to_jsonb(v_ids), '[]'::jsonb)
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate active task; import rolled back' USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.import_tasks(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_tasks(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_tasks(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.normalize_task_title(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_task_title(text) TO authenticated;
