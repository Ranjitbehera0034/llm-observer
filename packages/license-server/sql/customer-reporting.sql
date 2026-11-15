-- Apply to a dedicated Supabase/PostgREST database. Service key stays server-side.
CREATE TABLE IF NOT EXISTS public.observer_customers (
  id text PRIMARY KEY, email text, status text NOT NULL, valid_until timestamptz,
  test_mode boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.observer_installations (
  id uuid PRIMARY KEY, token_hash text NOT NULL, customer_ref text,
  plan text NOT NULL CHECK (plan IN ('free','trial','pro')), valid_until timestamptz,
  version text NOT NULL, first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.observer_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observer_installations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.observer_customers, public.observer_installations FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.report_observer_activity(installation uuid, secret_hash text, app_version text, customer_ref text, plan_name text, paid_until timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE accepted integer;
BEGIN
  INSERT INTO observer_installations AS existing(id, token_hash, version, customer_ref, plan, valid_until)
  VALUES(installation, secret_hash, app_version, customer_ref, plan_name, paid_until)
  ON CONFLICT(id) DO UPDATE SET version = excluded.version, customer_ref = excluded.customer_ref,
    plan = excluded.plan, valid_until = excluded.valid_until, last_seen = now()
  WHERE existing.token_hash = excluded.token_hash;
  GET DIAGNOSTICS accepted = ROW_COUNT;
  RETURN accepted = 1;
END $$;
CREATE OR REPLACE FUNCTION public.forget_observer_installation(installation uuid, secret_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  DELETE FROM observer_installations WHERE id = installation AND token_hash = secret_hash;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.report_observer_activity(uuid,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.forget_observer_installation(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_observer_activity(uuid,text,text,text,text,timestamptz), public.forget_observer_installation(uuid,text) TO service_role;
GRANT ALL ON public.observer_customers, public.observer_installations TO service_role;
-- Schedule daily in your database: DELETE FROM public.observer_installations WHERE last_seen < now() - interval '90 days';
