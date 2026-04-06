create or replace function public.bootstrap_staff_account(
  profile_name text,
  profile_role text,
  service_center_name text default 'Nord Garage',
  service_center_city text default 'Москва'
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
        approval_status = excluded.approval_status,
        approved_at = excluded.approved_at,
        full_name = excluded.full_name;

  if profile_role = 'service_admin' then
    select id into target_service_center_id
    from public.service_centers
    where lower(name) = lower(service_center_name)
    order by created_at asc
    limit 1;

    if target_service_center_id is null then
      insert into public.service_centers (name, city, bays)
      values (service_center_name, service_center_city, 6)
      returning id into target_service_center_id;
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

    insert into public.service_queue (
      service_center_id,
      customer_name,
      car_label,
      work_type,
      scheduled_at,
      status
    )
    select
      target_service_center_id,
      'Тестовый клиент',
      'BMW 320d Touring',
      'Первичная приемка и диагностика',
      now() + interval '1 day',
      'confirmed'
    where not exists (
      select 1
      from public.service_queue
      where service_center_id = target_service_center_id
    );
  end if;

  return coalesce(target_service_center_id, current_user_id);
end;
$$;

grant execute on function public.bootstrap_staff_account(text, text, text, text) to authenticated;
