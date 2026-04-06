alter table public.users
add column if not exists approval_status text not null default 'approved'
check (approval_status in ('approved', 'pending'));

alter table public.users
add column if not exists approved_at timestamptz;

update public.users
set approval_status = case when role = 'mechanic' then 'pending' else 'approved' end
where approval_status is null or approval_status = 'approved';
