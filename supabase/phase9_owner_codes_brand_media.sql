alter table public.vehicles
add column if not exists owner_code text;

update public.vehicles
set owner_code = owner_id::text
where owner_code is null or owner_code is distinct from owner_id::text;

create unique index if not exists vehicles_owner_code_uidx on public.vehicles(owner_code);

insert into public.vehicle_brand_media (brand, image_path, accent_color)
values
  ('Hyundai', 'https://commons.wikimedia.org/wiki/Special:FilePath/24%20Hyundai%20Tucson%20SE.jpg', '#1d7aa8'),
  ('Kia', 'https://commons.wikimedia.org/wiki/Special:FilePath/%2723-%2725%20Kia%20Sportage.JPG', '#bc3d3d')
on conflict do nothing;

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
      owner_code,
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
      current_user_id::text,
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
        owner_code = current_user_id::text,
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
