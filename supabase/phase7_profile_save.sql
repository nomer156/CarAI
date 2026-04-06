create or replace function public.save_owner_profile(
  profile_name text,
  vehicle_brand text,
  vehicle_model text,
  vehicle_year int,
  vehicle_vin text,
  vehicle_plate text,
  vehicle_mileage_km int,
  vehicle_engine text,
  vehicle_color text,
  vehicle_next_inspection date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_vehicle_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.users (id, role, approval_status, approved_at, full_name)
  values (
    current_user_id,
    'owner',
    'approved',
    now(),
    profile_name
  )
  on conflict (id) do update
    set role = 'owner',
        approval_status = 'approved',
        approved_at = coalesce(public.users.approved_at, now()),
        full_name = excluded.full_name;

  select id into target_vehicle_id
  from public.vehicles
  where owner_id = current_user_id
  order by created_at asc
  limit 1;

  if target_vehicle_id is null then
    insert into public.vehicles (
      owner_id,
      brand,
      model,
      model_year,
      vin,
      plate,
      mileage_km,
      engine,
      color,
      next_inspection
    )
    values (
      current_user_id,
      vehicle_brand,
      vehicle_model,
      vehicle_year,
      vehicle_vin,
      vehicle_plate,
      vehicle_mileage_km,
      vehicle_engine,
      vehicle_color,
      vehicle_next_inspection
    )
    returning id into target_vehicle_id;
  else
    update public.vehicles
    set brand = vehicle_brand,
        model = vehicle_model,
        model_year = vehicle_year,
        vin = vehicle_vin,
        plate = vehicle_plate,
        mileage_km = vehicle_mileage_km,
        engine = vehicle_engine,
        color = vehicle_color,
        next_inspection = vehicle_next_inspection
    where id = target_vehicle_id;
  end if;

  return target_vehicle_id;
end;
$$;

grant execute on function public.save_owner_profile(text, text, text, int, text, text, int, text, text, date) to authenticated;

create or replace function public.save_staff_profile(
  profile_name text,
  profile_role text,
  service_center_name text,
  service_center_city text,
  service_center_bays int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_service_center_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if profile_role not in ('service_admin', 'company_admin') then
    raise exception 'Invalid role';
  end if;

  insert into public.users (id, role, approval_status, approved_at, full_name)
  values (
    current_user_id,
    profile_role,
    'approved',
    now(),
    profile_name
  )
  on conflict (id) do update
    set role = excluded.role,
        approval_status = 'approved',
        approved_at = coalesce(public.users.approved_at, now()),
        full_name = excluded.full_name;

  if profile_role = 'company_admin' then
    return current_user_id;
  end if;

  select id into target_service_center_id
  from public.service_centers
  where lower(name) = lower(service_center_name)
  order by created_at asc
  limit 1;

  if target_service_center_id is null then
    insert into public.service_centers (name, city, bays)
    values (service_center_name, service_center_city, greatest(service_center_bays, 1))
    returning id into target_service_center_id;
  else
    update public.service_centers
    set name = service_center_name,
        city = service_center_city,
        bays = greatest(service_center_bays, 1)
    where id = target_service_center_id;
  end if;

  insert into public.service_center_staff (
    service_center_id,
    user_id,
    specialization,
    shift_label,
    is_active
  )
  select
    target_service_center_id,
    current_user_id,
    'Управление сервисом',
    '08:00 - 17:00',
    true
  where not exists (
    select 1
    from public.service_center_staff
    where user_id = current_user_id
      and service_center_id = target_service_center_id
  );

  return target_service_center_id;
end;
$$;

grant execute on function public.save_staff_profile(text, text, text, text, int) to authenticated;
