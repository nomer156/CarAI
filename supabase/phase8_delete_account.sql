create or replace function public.delete_my_account_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.service_center_staff
  where user_id = current_user_id;

  delete from public.vehicle_access
  where user_id = current_user_id;

  delete from public.vehicles
  where owner_id = current_user_id;

  delete from public.users
  where id = current_user_id;
end;
$$;

grant execute on function public.delete_my_account_data() to authenticated;
