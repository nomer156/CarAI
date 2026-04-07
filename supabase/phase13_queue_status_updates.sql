create or replace function public.update_service_queue_status(
  target_queue_id uuid,
  next_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  actor_role text;
  actor_service_center_id uuid;
  saved_queue_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if next_status not in ('new', 'confirmed', 'in_service', 'ready') then
    raise exception 'Invalid queue status';
  end if;

  select role into actor_role
  from public.users
  where id = current_user_id;

  if coalesce(actor_role, '') not in ('mechanic', 'service_admin', 'company_admin') then
    raise exception 'Insufficient permissions';
  end if;

  select service_center_id into actor_service_center_id
  from public.service_center_staff
  where user_id = current_user_id
  order by created_at asc
  limit 1;

  if actor_service_center_id is null then
    raise exception 'Service center not found';
  end if;

  update public.service_queue
  set status = next_status
  where id = target_queue_id
    and service_center_id = actor_service_center_id
  returning id into saved_queue_id;

  if saved_queue_id is null then
    raise exception 'Queue item not found';
  end if;

  return saved_queue_id;
end;
$$;

grant execute on function public.update_service_queue_status(uuid, text) to authenticated;
