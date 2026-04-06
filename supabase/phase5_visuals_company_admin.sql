alter table public.users
drop constraint if exists users_role_check;

alter table public.users
add constraint users_role_check
check (role in ('owner', 'mechanic', 'service_admin', 'company_admin'));

alter table public.vehicles
add column if not exists color text;

create table if not exists public.vehicle_brand_media (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  image_path text not null,
  accent_color text,
  created_at timestamptz not null default now()
);

alter table public.vehicle_brand_media enable row level security;

insert into public.vehicle_brand_media (brand, image_path, accent_color)
values
  ('BMW', '/cars/bmw-sport.svg', '#4f8df6'),
  ('Mercedes', '/cars/mercedes-exec.svg', '#87aabf'),
  ('Toyota', '/cars/toyota-cross.svg', '#d26464')
on conflict do nothing;
