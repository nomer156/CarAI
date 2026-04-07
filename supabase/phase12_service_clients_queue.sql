alter table public.service_queue
add column if not exists owner_code text;

create table if not exists public.service_clients (
  id uuid primary key default gen_random_uuid(),
  service_center_id uuid not null references public.service_centers(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  owner_code text not null,
  customer_name text not null,
  customer_phone text,
  car_label text not null,
  last_visit date not null default current_date,
  created_at timestamptz not null default now()
);

create unique index if not exists service_clients_center_owner_uidx
on public.service_clients(service_center_id, owner_code);

alter table public.service_clients enable row level security;

create or replace function public.add_vehicle_to_service_intake(
  target_owner_code text,
  requested_work_type text default 'Новая запись по owner-коду',
  customer_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  actor_role text;
  target_service_center_id uuid;
  target_vehicle_id uuid;
  target_owner_id uuid;
  target_customer_name text;
  target_car_label text;
  saved_queue_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select role into actor_role
  from public.users
  where id = current_user_id;

  if coalesce(actor_role, '') not in ('mechanic', 'service_admin', 'company_admin') then
    raise exception 'Insufficient permissions';
  end if;

  select service_center_id into target_service_center_id
  from public.service_center_staff
  where user_id = current_user_id
  order by created_at asc
  limit 1;

  if target_service_center_id is null then
    raise exception 'Service center not found';
  end if;

  select v.id, v.owner_id, u.full_name, v.brand || ' ' || v.model
  into target_vehicle_id, target_owner_id, target_customer_name, target_car_label
  from public.vehicles v
  join public.users u on u.id = v.owner_id
  where v.owner_code = target_owner_code
  order by v.created_at asc
  limit 1;

  if target_vehicle_id is null then
    raise exception 'Vehicle not found';
  end if;

  insert into public.service_clients (
    service_center_id,
    vehicle_id,
    owner_code,
    customer_name,
    customer_phone,
    car_label,
    last_visit
  )
  values (
    target_service_center_id,
    target_vehicle_id,
    target_owner_code,
    target_customer_name,
    nullif(customer_phone, ''),
    target_car_label,
    current_date
  )
  on conflict do nothing;

  insert into public.service_queue (
    service_center_id,
    vehicle_id,
    owner_code,
    customer_name,
    car_label,
    work_type,
    scheduled_at,
    status
  )
  values (
    target_service_center_id,
    target_vehicle_id,
    target_owner_code,
    target_customer_name,
    target_car_label,
    requested_work_type,
    now(),
    'new'
  )
  returning id into saved_queue_id;

  return saved_queue_id;
end;
$$;

grant execute on function public.add_vehicle_to_service_intake(text, text, text) to authenticated;
