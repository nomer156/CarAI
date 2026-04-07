alter table public.parts
add column if not exists installation_source text not null default 'service';

alter table public.parts
drop constraint if exists parts_installation_source_check;

alter table public.parts
add constraint parts_installation_source_check
check (installation_source in ('self', 'service'));

create or replace function public.upsert_vehicle_part(
  target_owner_code text,
  target_part_id uuid,
  part_name text,
  part_oem text,
  part_manufacturer text default null,
  part_price numeric default 0,
  part_status text default 'ok',
  part_note text default null,
  part_source text default 'service'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_vehicle_id uuid;
  target_vehicle_owner uuid;
  actor_role text;
  saved_part_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if part_status not in ('ok', 'watch', 'replace') then
    raise exception 'Invalid part status';
  end if;

  if part_source not in ('self', 'service') then
    raise exception 'Invalid part source';
  end if;

  select role into actor_role
  from public.users
  where id = current_user_id;

  if coalesce(trim(target_owner_code), '') = '' then
    select id, owner_id into target_vehicle_id, target_vehicle_owner
    from public.vehicles
    where owner_id = current_user_id
    order by created_at asc
    limit 1;
  else
    select id, owner_id into target_vehicle_id, target_vehicle_owner
    from public.vehicles
    where owner_code = target_owner_code
    order by created_at asc
    limit 1;
  end if;

  if target_vehicle_id is null then
    raise exception 'Vehicle not found';
  end if;

  if target_vehicle_owner <> current_user_id and coalesce(actor_role, '') not in ('mechanic', 'service_admin', 'company_admin') then
    raise exception 'Insufficient permissions';
  end if;

  if target_part_id is null then
    insert into public.parts (
      vehicle_id,
      name,
      oem,
      manufacturer,
      price,
      status,
      note,
      installation_source
    )
    values (
      target_vehicle_id,
      part_name,
      part_oem,
      nullif(part_manufacturer, ''),
      coalesce(part_price, 0),
      part_status,
      nullif(part_note, ''),
      part_source
    )
    returning id into saved_part_id;
  else
    update public.parts
    set name = part_name,
        oem = part_oem,
        manufacturer = nullif(part_manufacturer, ''),
        price = coalesce(part_price, 0),
        status = part_status,
        note = nullif(part_note, ''),
        installation_source = part_source
    where id = target_part_id
      and vehicle_id = target_vehicle_id
    returning id into saved_part_id;

    if saved_part_id is null then
      raise exception 'Part not found';
    end if;
  end if;

  return saved_part_id;
end;
$$;

grant execute on function public.upsert_vehicle_part(text, uuid, text, text, text, numeric, text, text, text) to authenticated;

create or replace function public.add_service_record_by_owner_code(
  target_owner_code text,
  record_title text,
  record_details text default null,
  record_location text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  actor_role text;
  target_vehicle_id uuid;
  saved_record_id uuid;
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

  select id into target_vehicle_id
  from public.vehicles
  where owner_code = target_owner_code
  order by created_at asc
  limit 1;

  if target_vehicle_id is null then
    raise exception 'Vehicle not found';
  end if;

  insert into public.service_records (
    vehicle_id,
    mechanic_id,
    service_date,
    title,
    location,
    details,
    verified
  )
  values (
    target_vehicle_id,
    current_user_id,
    current_date,
    record_title,
    nullif(record_location, ''),
    nullif(record_details, ''),
    true
  )
  returning id into saved_record_id;

  return saved_record_id;
end;
$$;

grant execute on function public.add_service_record_by_owner_code(text, text, text, text) to authenticated;
