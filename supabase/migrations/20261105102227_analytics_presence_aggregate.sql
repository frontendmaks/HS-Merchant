-- Preserve the existing seven-minute gap rule and Kyiv roster boundaries.
create function public.merchant_presence_minutes(p_from date,p_to date)
returns table(user_id uuid,online_minutes int) language sql stable security invoker set search_path='' as $$
with ticks as (
 select user_id,minute,lag(minute) over(partition by user_id order by minute) previous
 from public.presence_ticks
 where minute>=p_from::timestamp at time zone 'UTC'
 and minute<=(p_to::timestamp+time '23:59:59') at time zone 'UTC'
), spans as (
 select t.user_id,t.minute,t.previous,
 ((t.previous at time zone 'Europe/Kyiv')::date+time '09:00') at time zone 'Europe/Kyiv' opened,
 ((t.previous at time zone 'Europe/Kyiv')::date+time '17:00') at time zone 'Europe/Kyiv' closed
 from ticks t where t.minute>t.previous and t.minute-t.previous<=interval '7 minutes'
 and exists(select 1 from public.work_shifts s where s.operator_id=t.user_id
 and s.work_date=(t.previous at time zone 'Europe/Kyiv')::date)
) select user_id,round(sum(greatest(0,extract(epoch from least(minute,closed)-greatest(previous,opened))/60)))::int
from spans group by user_id
$$;
alter table public.integration_webhooks add column if not exists event_key text;
create unique index if not exists integration_webhooks_event_key_idx on public.integration_webhooks(client_id,event_key);
create function public.merchant_sheet_state(p_order_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('state',state,'created_at',created_at,'error',error)
 from merchant_private.sheet_deliveries where order_id=p_order_id
$$;
revoke all on function public.merchant_presence_minutes(date,date),public.merchant_sheet_state(uuid) from public,anon,authenticated;
grant execute on function public.merchant_presence_minutes(date,date),public.merchant_sheet_state(uuid) to service_role;
