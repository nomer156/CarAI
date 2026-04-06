create or replace function public.bootstrap_demo_garage(
  profile_name text,
  profile_role text default 'owner'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  new_vehicle_id uuid;
  air_mass_sensor_id uuid;
  brake_pads_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if profile_role not in ('owner', 'mechanic') then
    raise exception 'Invalid role';
  end if;

  insert into public.users (id, role, approval_status, approved_at, full_name)
  values (
    current_user_id,
    profile_role,
    case when profile_role = 'mechanic' then 'pending' else 'approved' end,
    case when profile_role = 'mechanic' then null else now() end,
    profile_name
  )
  on conflict (id) do update
    set role = excluded.role,
        approval_status = excluded.approval_status,
        approved_at = excluded.approved_at,
        full_name = excluded.full_name;

  select id into new_vehicle_id
  from public.vehicles
  where owner_id = current_user_id
  order by created_at asc
  limit 1;

  if new_vehicle_id is not null then
    return new_vehicle_id;
  end if;

  insert into public.vehicles (
    owner_id,
    brand,
    model,
    model_year,
    vin,
    plate,
    mileage_km,
    engine,
    next_inspection
  )
  values (
    current_user_id,
    'BMW',
    '320d Touring',
    2019,
    'WBA8J31040K123456',
    'A123BC 77',
    128400,
    '2.0 дизель, 190 л.с.',
    '2026-07-19'
  )
  returning id into new_vehicle_id;

  insert into public.parts (vehicle_id, name, oem, manufacturer, price, status, note)
  values (
    new_vehicle_id,
    'Масляный фильтр',
    '11428575211',
    'MANN-FILTER',
    1180,
    'ok',
    'Оригинальный OEM сохранен, замена каждые 10 000 км.'
  );

  insert into public.parts (vehicle_id, name, oem, manufacturer, price, status, note)
  values (
    new_vehicle_id,
    'Передние тормозные колодки',
    '34116865460',
    'ATE',
    8200,
    'watch',
    'Остаток около 30%, стоит контролировать перед летом.'
  )
  returning id into brake_pads_id;

  insert into public.parts (vehicle_id, name, oem, manufacturer, price, status, note)
  values (
    new_vehicle_id,
    'Датчик массового расхода воздуха',
    '13628589846',
    'Bosch',
    13990,
    'replace',
    'По диагностике есть плавающая ошибка, желательно заказать заранее.'
  )
  returning id into air_mass_sensor_id;

  insert into public.maintenance_tasks (vehicle_id, title, due_at_km, last_done_km, interval_km, priority, notes)
  values
    (new_vehicle_id, 'Замена масла и масляного фильтра', 130000, 120400, 10000, 'high', 'Рекомендуемое масло 5W-30 LL-04.'),
    (new_vehicle_id, 'ТО АКПП', 140000, 80000, 60000, 'medium', 'С заменой масла, фильтра и адаптацией.'),
    (new_vehicle_id, 'Проверка и замена охлаждающей жидкости', 150000, 95000, 55000, 'low', 'Проверить герметичность расширительного бачка.');

  insert into public.service_records (vehicle_id, mechanic_id, service_date, title, location, details, verified)
  values
    (new_vehicle_id, current_user_id, '2026-02-14', 'Плановое ТО', 'Nord Garage', 'Заменены масло, масляный фильтр, салонный фильтр. Проверка подвески без замечаний.', true),
    (new_vehicle_id, current_user_id, '2025-11-03', 'Замена передних амортизаторов', 'Nord Garage', 'Установлены Bilstein B4, выполнен сход-развал.', true);

  insert into public.accident_records (vehicle_id, event_date, title, severity, details)
  values (new_vehicle_id, '2024-09-12', 'Небольшое ДТП во дворе', 'minor', 'Окрашен задний бампер, повреждений силовых элементов не было.');

  insert into public.documents (vehicle_id, title, category, issued_at, expires_at, verified)
  values
    (new_vehicle_id, 'Полис ОСАГО', 'insurance', '2026-01-20', '2027-01-19', true),
    (new_vehicle_id, 'Диагностическая карта', 'inspection', '2025-07-19', '2026-07-19', true),
    (new_vehicle_id, 'Заказ-наряд по амортизаторам', 'invoice', '2025-11-03', null, true);

  insert into public.marketplace_offers (vehicle_id, part_id, seller, condition, price, eta_days)
  values
    (new_vehicle_id, air_mass_sensor_id, 'Exist', 'oem', 14500, 2),
    (new_vehicle_id, air_mass_sensor_id, 'Autodoc', 'aftermarket', 11900, 4),
    (new_vehicle_id, brake_pads_id, 'Emex', 'new', 7900, 1);

  return new_vehicle_id;
end;
$$;

grant execute on function public.bootstrap_demo_garage(text, text) to authenticated;
