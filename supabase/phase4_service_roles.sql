alter table public.users
drop constraint if exists users_role_check;

alter table public.users
add constraint users_role_check
check (role in ('owner', 'mechanic', 'service_admin'));

alter table public.users
drop constraint if exists users_approval_status_check;

alter table public.users
add constraint users_approval_status_check
check (approval_status in ('approved', 'pending', 'inactive'));

create table if not exists public.service_centers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  bays int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.service_center_staff (
  id uuid primary key default gen_random_uuid(),
  service_center_id uuid not null references public.service_centers(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  specialization text,
  shift_label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.service_queue (
  id uuid primary key default gen_random_uuid(),
  service_center_id uuid not null references public.service_centers(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  customer_name text not null,
  car_label text not null,
  work_type text not null,
  scheduled_at timestamptz not null,
  status text not null check (status in ('new', 'confirmed', 'in_service', 'ready')),
  created_at timestamptz not null default now()
);

alter table public.service_centers enable row level security;
alter table public.service_center_staff enable row level security;
alter table public.service_queue enable row level security;
