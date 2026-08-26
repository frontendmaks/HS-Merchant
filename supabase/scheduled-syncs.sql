-- Sync schedules (live in Supabase, not vercel.json).
--
-- Why here: the Vercel plan is Hobby, where cron jobs may only run once per
-- day. pg_cron has no such limit, so the frequent schedules run from Postgres
-- and call the app over HTTP.
--
-- This file documents what is already applied to the database. Re-running it is
-- safe: cron.schedule() upserts a job by name.
--
--   orders-quick-sync         */5 * * * *   ~4 marketplace requests, ~2s
--   orders-full-sync          2 */3 * * *   ~26 requests, ~8s (re-reads the year)
--   hourly-wc-sync            10 * * * *    full WooCommerce product sync, 135-225s
--   order-sync-logs-cleanup   30 4 * * *    drops auto logs older than 7 days
--   schedule-reminder-morning 0 7,8 * * 5    nudge operators to file next week
--   schedule-reminder-deadline 5 13,14 * * 5 same, and tell management if late
--
-- The full run is offset by two minutes so it never coincides with a quick run.
--
-- hourly-wc-sync keeps feed prices and stock current; a run takes long enough
-- that pg_net often discards the response body, which is harmless — the app
-- records every run in sync_logs, and that is where to check the outcome.
--
-- The Vercel crons in vercel.json (03:00 products, 04:00 orders — both daily)
-- stay as a backstop in case pg_cron or the database is unavailable.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- One-off, run manually — never commit real values:
--   SELECT vault.create_secret('<CRON_SECRET>', 'hs_cron_secret', '...');
--   SELECT vault.create_secret('https://hs-merchant.vercel.app', 'hs_app_url', '...');

CREATE OR REPLACE FUNCTION public.trigger_order_sync(p_mode text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url     text;
  v_secret  text;
  v_request bigint;
BEGIN
  IF p_mode NOT IN ('quick', 'full') THEN
    RAISE EXCEPTION 'unknown sync mode: %', p_mode;
  END IF;

  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'hs_app_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'hs_cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'hs_app_url or hs_cron_secret missing from vault';
  END IF;

  SELECT net.http_get(
    url                  := v_url || '/api/cron/sync-orders?mode=' || p_mode,
    headers              := jsonb_build_object('x-cron-secret', v_secret),
    timeout_milliseconds := 55000
  ) INTO v_request;

  RETURN v_request;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_order_sync(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trigger_product_sync()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url     text;
  v_secret  text;
  v_request bigint;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'hs_app_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'hs_cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'hs_app_url or hs_cron_secret missing from vault';
  END IF;

  SELECT net.http_get(
    url                  := v_url || '/api/cron/sync',
    headers              := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 290000
  ) INTO v_request;

  RETURN v_request;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_product_sync() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('orders-quick-sync', '*/5 * * * *', $$SELECT public.trigger_order_sync('quick')$$);
SELECT cron.schedule('orders-full-sync',  '2 */3 * * *', $$SELECT public.trigger_order_sync('full')$$);
SELECT cron.schedule('hourly-wc-sync',    '10 * * * *',  $$SELECT public.trigger_product_sync()$$);

SELECT cron.schedule(
  'order-sync-logs-cleanup', '30 4 * * *',
  $$DELETE FROM public.order_sync_logs
    WHERE trigger = 'auto'
      AND status = 'success'
      AND created_at < now() - interval '7 days'$$
);

-- Handy checks -------------------------------------------------------------
-- Schedules:      SELECT jobname, schedule, active FROM cron.job;
-- Recent runs:    SELECT j.jobname, d.status, d.start_time
--                 FROM cron.job_run_details d JOIN cron.job j USING (jobid)
--                 ORDER BY d.start_time DESC LIMIT 20;
-- HTTP responses: SELECT id, status_code, content FROM net._http_response
--                 ORDER BY id DESC LIMIT 10;
-- App-side log:   SELECT * FROM order_sync_logs ORDER BY created_at DESC LIMIT 20;
-- Product syncs:  SELECT created_at, status, synced, deactivated, duration_ms
--                 FROM sync_logs ORDER BY created_at DESC LIMIT 20;
-- Change cadence: SELECT cron.schedule('orders-quick-sync', '*/3 * * * *',
--                   $$SELECT public.trigger_order_sync('quick')$$);
-- Pause:          SELECT cron.unschedule('orders-quick-sync');


-- Friday reminder to file next week's schedule.
--
-- pg_cron runs in UTC while Kyiv moves between UTC+2 and UTC+3, so each
-- reminder is scheduled at both offsets and the route decides from Kyiv
-- wall-clock time. It refuses any day but Friday and will not repeat a
-- reminder of the same kind within twelve hours, so the extra pass is inert.
--
-- SELECT cron.schedule('schedule-reminder-morning',  '0 7,8 * * 5',
--   $$SELECT public.trigger_schedule_reminder()$$);
-- SELECT cron.schedule('schedule-reminder-deadline', '5 13,14 * * 5',
--   $$SELECT public.trigger_schedule_reminder()$$);
