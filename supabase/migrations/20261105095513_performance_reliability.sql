-- Private operational state is available only to the server's service role.
create schema if not exists merchant_private;
revoke all on schema merchant_private from public, anon, authenticated;
grant usage on schema merchant_private to service_role;

create materialized view merchant_private.last_prices as
select distinct on (i.bitrix_product_id) i.bitrix_product_id as product_id,
 i.price_per_unit as price, i.unit, o.delivery_date as sold_on
from public.order_items i join public.orders o on o.id=i.order_id
where i.bitrix_product_id is not null and i.price_per_unit>0
order by i.bitrix_product_id,o.delivery_date desc nulls last,i.created_at desc;
create unique index last_prices_product_idx on merchant_private.last_prices(product_id);
grant select on merchant_private.last_prices to service_role;
create or replace view public.bitrix_last_price with (security_invoker=true) as
select product_id,price,unit,sold_on from merchant_private.last_prices;
revoke all on public.bitrix_last_price from public,anon,authenticated;
grant select on public.bitrix_last_price to service_role;
select cron.schedule('merchant-last-prices','*/5 * * * *',
 'refresh materialized view concurrently merchant_private.last_prices');

create table merchant_private.leases (
 key text primary key, token uuid not null, expires_at timestamptz not null
);
create table merchant_private.sheet_deliveries (
 order_id uuid primary key references public.orders(id) on delete cascade,
 state text not null check(state in ('sending','sent','uncertain')),
 created_at timestamptz not null default now(), error text
);
create table merchant_private.order_effects (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 status text not null, created_at timestamptz not null default now(),
 state text not null default 'pending', attempts int not null default 0,
 available_at timestamptz not null default now(), token uuid, error text
);
create index order_effects_due_idx on merchant_private.order_effects(available_at) where state<>'done';
alter table merchant_private.leases enable row level security;
alter table merchant_private.sheet_deliveries enable row level security;
alter table merchant_private.order_effects enable row level security;
grant select,insert,update,delete on all tables in schema merchant_private to service_role;

create function public.merchant_acquire_lease(p_key text,p_token uuid,p_seconds int default 300)
returns boolean language sql security invoker set search_path='' as $$
 with claimed as (
 insert into merchant_private.leases as l(key,token,expires_at)
 values(p_key,p_token,now()+make_interval(secs=>least(greatest(p_seconds,10),900)))
 on conflict(key) do update set token=excluded.token,expires_at=excluded.expires_at
 where l.expires_at<now() returning 1)
 select exists(select 1 from claimed)
$$;
create function public.merchant_release_lease(p_key text,p_token uuid)
returns void language sql security invoker set search_path='' as $$
 delete from merchant_private.leases where key=p_key and token=p_token
$$;
create function public.merchant_claim_sheet(p_order_id uuid)
returns boolean language sql security invoker set search_path='' as $$
 with claimed as (insert into merchant_private.sheet_deliveries(order_id,state)
 values(p_order_id,'sending') on conflict do nothing returning 1)
 select exists(select 1 from claimed)
$$;
create function public.merchant_finish_sheet(p_order_id uuid,p_error text default null)
returns void language sql security invoker set search_path='' as $$
 update merchant_private.sheet_deliveries set state=case when p_error is null then 'sent' else 'uncertain' end,error=p_error
 where order_id=p_order_id
$$;
-- Local status, audit and side-effect outbox commit in one transaction.
create function public.merchant_commit_status(p_order_id uuid,p_expected_at timestamptz,p_status text,p_actor jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare previous text;
begin
 select status into previous from public.orders where id=p_order_id for update;
 if not found then return false; end if;
 update public.orders set status=p_status,updated_at=clock_timestamp()
 where id=p_order_id and updated_at is not distinct from p_expected_at;
 if not found then return false; end if;
 if previous is distinct from p_status then
 insert into public.order_events(order_id,actor_id,actor_name,type,old_value,new_value)
 values(p_order_id,
   case when exists(select 1 from public.profiles where id=nullif(p_actor->>'id','')::uuid)
    then nullif(p_actor->>'id','')::uuid else null end,
   p_actor->>'name','status',previous,p_status);
 insert into merchant_private.order_effects(order_id,status) values(p_order_id,p_status);
 end if;
 return true;
end $$;
create function public.merchant_claim_effects(p_limit int,p_token uuid)
returns jsonb language sql security invoker set search_path='' as $$
 with due as (select id from merchant_private.order_effects
 where state<>'done' and available_at<=now() and attempts<10
 order by created_at for update skip locked limit least(p_limit,20)),
 claimed as (update merchant_private.order_effects e set state='running',token=p_token,
 attempts=attempts+1,available_at=now()+interval '5 minutes'
 from due where e.id=due.id returning e.id,e.order_id,e.status)
 select coalesce(jsonb_agg(claimed),'[]'::jsonb) from claimed
$$;
create function public.merchant_finish_effect(p_id uuid,p_token uuid,p_error text default null)
returns void language sql security invoker set search_path='' as $$
 update merchant_private.order_effects set
 state=case when p_error is null then 'done' else 'pending' end,
 error=p_error,available_at=now()+interval '1 minute' * least(attempts*attempts,60)
 where id=p_id and token=p_token
$$;
-- Aggregate counts in one pass instead of four REST requests.
create function public.merchant_nav_counts(p_user_id uuid,p_new text[],p_processing text[])
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('requests',(select jsonb_build_object(
 'new',count(*) filter(where r.status='new'),
 'inProgress',count(*) filter(where r.status='in_progress'))
 from public.requests r join public.request_assignees a on a.request_id=r.id where a.user_id=p_user_id),
 'orders',(select jsonb_build_object('new',count(*) filter(where status=any(p_new)),
 'processing',count(*) filter(where status=any(p_processing))) from public.orders))
$$;
revoke all on function public.merchant_acquire_lease(text,uuid,int),public.merchant_release_lease(text,uuid),
 public.merchant_claim_sheet(uuid),public.merchant_finish_sheet(uuid,text),
 public.merchant_commit_status(uuid,timestamptz,text,jsonb),public.merchant_claim_effects(int,uuid),
 public.merchant_finish_effect(uuid,uuid,text),public.merchant_nav_counts(uuid,text[],text[]) from public,anon,authenticated;
grant execute on function public.merchant_acquire_lease(text,uuid,int),public.merchant_release_lease(text,uuid),
 public.merchant_claim_sheet(uuid),public.merchant_finish_sheet(uuid,text),
 public.merchant_commit_status(uuid,timestamptz,text,jsonb),public.merchant_claim_effects(int,uuid),
 public.merchant_finish_effect(uuid,uuid,text),public.merchant_nav_counts(uuid,text[],text[]) to service_role;
