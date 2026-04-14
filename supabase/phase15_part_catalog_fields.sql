alter table public.parts
add column if not exists assembly text;

alter table public.parts
add column if not exists sub_assembly text;

alter table public.parts
add column if not exists analogs text;

create or replace function public.upsert_vehicle_part(
  target_owner_code text,
  target_part_id uuid,
  part_assembly text default null,
  part_sub_assembly text default null,
  part_name text default null,
  part_oem text default null,
  part_analogs text default null,
  part_manufacturer text default null,
  part_price numeric default 0,
  part_status text default 'ok',
  part_note text default null,
  part_source text default 'service',
  part_installed_at date default null,
  part_installed_mileage_km int default null,
  part_next_replacement_km int default null
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
      assembly,
      sub_assembly,
      name,
      oem,
      analogs,
      manufacturer,
      price,
      status,
      note,
      installation_source,
      installed_at,
      installed_mileage_km,
      next_replacement_km
    )
    values (
      target_vehicle_id,
      nullif(part_assembly, ''),
      nullif(part_sub_assembly, ''),
      part_name,
      part_oem,
      nullif(part_analogs, ''),
      nullif(part_manufacturer, ''),
      coalesce(part_price, 0),
      part_status,
      nullif(part_note, ''),
      part_source,
      part_installed_at,
      part_installed_mileage_km,
      part_next_replacement_km
    )
    returning id into saved_part_id;
  else
    update public.parts
    set assembly = nullif(part_assembly, ''),
        sub_assembly = nullif(part_sub_assembly, ''),
        name = part_name,
        oem = part_oem,
        analogs = nullif(part_analogs, ''),
        manufacturer = nullif(part_manufacturer, ''),
        price = coalesce(part_price, 0),
        status = part_status,
        note = nullif(part_note, ''),
        installation_source = part_source,
        installed_at = part_installed_at,
        installed_mileage_km = part_installed_mileage_km,
        next_replacement_km = part_next_replacement_km
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

grant execute on function public.upsert_vehicle_part(text, uuid, text, text, text, text, text, text, numeric, text, text, text, date, int, int) to authenticated;
