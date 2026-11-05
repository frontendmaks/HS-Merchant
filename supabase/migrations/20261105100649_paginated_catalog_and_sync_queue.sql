create function public.merchant_product_page(p_filters jsonb default '{}')
returns jsonb language sql stable security invoker set search_path='' as $$
with filtered as materialized (
 select id,name,sku,price,price_old,stock,status,images,external_id,category_name,categories,brand,attributes,unit,vendor
 from public.products p where
 (coalesce(p_filters->>'status','')='' or (p_filters->>'status'='active' and status='active') or (p_filters->>'status'='inactive' and status<>'active'))
 and (coalesce(p_filters->>'q','')='' or strpos(lower(name),lower(p_filters->>'q'))>0 or strpos(lower(coalesce(sku,'')),lower(p_filters->>'q'))>0)
 and (coalesce((p_filters->>'inStock')::boolean,false)=false or stock>0)
 and (coalesce((p_filters->>'outStock')::boolean,false)=false or stock<=0)
 and (coalesce((p_filters->>'warehouse')::boolean,false)=false or stock is not null)
 and (coalesce((p_filters->>'sale')::boolean,false)=false or price_old is not null)
 and (coalesce(p_filters->>'saleCat','')='' or p_filters->>'saleCat'=any(categories))
 and (coalesce((p_filters->>'noSaleCat')::boolean,false)=false or (price_old is not null and not exists(select 1 from unnest(categories) c where lower(c) like '%акці%')))
 and (coalesce(p_filters->>'unit','')='' or ((p_filters->>'unit'='weight')=coalesce(lower(attributes->>'Одиниця')=any(array['кг','г','мл','л']),false)))
), numbered as (
 select f.* from filtered f order by
 case when p_filters->>'dir'='desc' then null else case coalesce(p_filters->>'sort','name') when 'name' then name when 'status' then status::text when 'category_name' then coalesce(category_name,'') when 'brand' then coalesce(brand,'') end end asc,
 case when p_filters->>'dir'='desc' then case coalesce(p_filters->>'sort','name') when 'name' then name when 'status' then status::text when 'category_name' then coalesce(category_name,'') when 'brand' then coalesce(brand,'') end end desc,
 case when p_filters->>'dir'='desc' then null else case p_filters->>'sort' when 'price' then price when 'stock' then coalesce(stock,-1) end end asc,
 case when p_filters->>'dir'='desc' then case p_filters->>'sort' when 'price' then price when 'stock' then coalesce(stock,-1) end end desc,id
 limit 50 offset (greatest(1,least(10000,coalesce((p_filters->>'page')::int,1)))-1)*50
) select jsonb_build_object('products',coalesce((select jsonb_agg(to_jsonb(n)||'{"description":null}'::jsonb) from numbered n),'[]'::jsonb),
 'count',(select count(*) from filtered))
$$;
create function public.merchant_product_facets() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(c order by c),'[]'::jsonb) from (
 select distinct unnest(categories) c from public.products) cats where lower(c) like '%акці%'
$$;

create table merchant_private.bitrix_events(
 deal_id bigint primary key, requested_at timestamptz not null default clock_timestamp(),
 available_at timestamptz not null default now(), token uuid, attempts int not null default 0, error text
);
alter table merchant_private.bitrix_events enable row level security;
grant select,insert,update,delete on merchant_private.bitrix_events to service_role;
create function public.merchant_enqueue_bitrix(p_deal_id bigint) returns void
language sql security invoker set search_path='' as $$
 insert into merchant_private.bitrix_events as e(deal_id) values(p_deal_id)
 on conflict(deal_id) do update set requested_at=clock_timestamp(),attempts=0,
 available_at=case when e.token is null then now() else e.available_at end
$$;
create function public.merchant_claim_bitrix(p_token uuid,p_limit int default 3) returns jsonb
language sql security invoker set search_path='' as $$
 with due as(select deal_id from merchant_private.bitrix_events where available_at<=now() and attempts<10
 order by requested_at for update skip locked limit least(p_limit,10)),
 claimed as(update merchant_private.bitrix_events e set token=p_token,attempts=attempts+1,
 available_at=now()+interval '5 minutes' from due where e.deal_id=due.deal_id returning e.deal_id,e.requested_at)
 select coalesce(jsonb_agg(claimed),'[]'::jsonb) from claimed
$$;
create function public.merchant_finish_bitrix(p_deal_id bigint,p_token uuid,p_requested_at timestamptz,p_error text default null)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_error is null then
 delete from merchant_private.bitrix_events where deal_id=p_deal_id and token=p_token and requested_at=p_requested_at;
 end if;
 update merchant_private.bitrix_events set token=null,error=p_error,
 available_at=case when p_error is null then now() else now()+interval '1 minute' end
 where deal_id=p_deal_id and token=p_token;
end $$;
revoke all on function public.merchant_product_page(jsonb),public.merchant_product_facets(),
 public.merchant_enqueue_bitrix(bigint),public.merchant_claim_bitrix(uuid,int),
 public.merchant_finish_bitrix(bigint,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.merchant_product_page(jsonb),public.merchant_product_facets(),
 public.merchant_enqueue_bitrix(bigint),public.merchant_claim_bitrix(uuid,int),
 public.merchant_finish_bitrix(bigint,uuid,timestamptz,text) to service_role;
