create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'mechanic', 'service_admin', 'company_admin')),
  approval_status text not null default 'approved' check (approval_status in ('approved', 'pending', 'inactive')),
  full_name text not null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.service_centers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  bays int not null default 1,
  created_at timestamptz not null default now()
);

create table public.service_center_staff (
  id uuid primary key default gen_random_uuid(),
  service_center_id uuid not null references public.service_centers(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  specialization text,
  shift_label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.service_queue (
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

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id),
  brand text not null,
  model text not null,
  model_year int not null,
  vin text not null unique,
  plate text,
  mileage_km int not null default 0,
  engine text,
  color text,
  next_inspection date,
  created_at timestamptz not null default now()
);

create table public.vehicle_brand_media (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  image_path text not null,
  accent_color text,
  created_at timestamptz not null default now()
);

create table public.vehicle_access (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  permission text not null check (permission in ('view', 'edit', 'service')),
  created_at timestamptz not null default now()
);

create table public.parts (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  name text not null,
  oem text not null,
  manufacturer text,
  price numeric(10, 2),
  status text not null check (status in ('ok', 'watch', 'replace')),
  note text,
  created_at timestamptz not null default now()
);

create table public.maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  title text not null,
  due_at_km int not null,
  last_done_km int not null default 0,
  interval_km int not null,
  priority text not null check (priority in ('low', 'medium', 'high')),
  notes text,
  created_at timestamptz not null default now()
);

create table public.service_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  mechanic_id uuid references public.users(id),
  service_date date not null,
  title text not null,
  location text,
  details text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.accident_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  event_date date not null,
  title text not null,
  severity text not null check (severity in ('minor', 'moderate', 'serious')),
  details text,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  title text not null,
  category text not null check (category in ('insurance', 'inspection', 'invoice', 'manual')),
  issued_at date not null,
  expires_at date,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.marketplace_offers (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  part_id uuid references public.parts(id) on delete cascade,
  seller text not null,
  condition text not null check (condition in ('new', 'oem', 'aftermarket')),
  price numeric(10, 2) not null,
  eta_days int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_access enable row level security;
alter table public.parts enable row level security;
alter table public.maintenance_tasks enable row level security;
alter table public.service_records enable row level security;
alter table public.accident_records enable row level security;
alter table public.documents enable row level security;
alter table public.marketplace_offers enable row level security;
alter table public.service_centers enable row level security;
alter table public.service_center_staff enable row level security;
alter table public.service_queue enable row level security;
alter table public.vehicle_brand_media enable row level security;

create policy "users can view own profile"
on public.users for select
using (auth.uid() = id);

create policy "owners and mechanics can read allowed vehicles"
on public.vehicles for select
using (
  owner_id = auth.uid()
  or exists (
    select 1
    from public.vehicle_access access
    where access.vehicle_id = vehicles.id
      and access.user_id = auth.uid()
  )
);

create policy "owners and mechanics can read access rows"
on public.vehicle_access for select
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.vehicles vehicles
    where vehicles.id = vehicle_access.vehicle_id
      and vehicles.owner_id = auth.uid()
  )
);

create policy "parts readable by shared users"
on public.parts for select
using (
  exists (
    select 1
    from public.vehicles vehicles
    left join public.vehicle_access access on access.vehicle_id = vehicles.id
    where vehicles.id = parts.vehicle_id
      and (vehicles.owner_id = auth.uid() or access.user_id = auth.uid())
  )
);

create policy "maintenance readable by shared users"
on public.maintenance_tasks for select
using (
  exists (
    select 1
    from public.vehicles vehicles
    left join public.vehicle_access access on access.vehicle_id = vehicles.id
    where vehicles.id = maintenance_tasks.vehicle_id
      and (vehicles.owner_id = auth.uid() or access.user_id = auth.uid())
  )
);

create policy "service records readable by shared users"
on public.service_records for select
using (
  exists (
    select 1
    from public.vehicles vehicles
    left join public.vehicle_access access on access.vehicle_id = vehicles.id
    where vehicles.id = service_records.vehicle_id
      and (vehicles.owner_id = auth.uid() or access.user_id = auth.uid())
  )
);

create policy "accidents readable by shared users"
on public.accident_records for select
using (
  exists (
    select 1
    from public.vehicles vehicles
    left join public.vehicle_access access on access.vehicle_id = vehicles.id
    where vehicles.id = accident_records.vehicle_id
      and (vehicles.owner_id = auth.uid() or access.user_id = auth.uid())
  )
);

create policy "documents readable by shared users"
on public.documents for select
using (
  exists (
    select 1
    from public.vehicles vehicles
    left join public.vehicle_access access on access.vehicle_id = vehicles.id
    where vehicles.id = documents.vehicle_id
      and (vehicles.owner_id = auth.uid() or access.user_id = auth.uid())
  )
);

create policy "offers readable by shared users"
on public.marketplace_offers for select
using (
  exists (
    select 1
    from public.vehicles vehicles
    left join public.vehicle_access access on access.vehicle_id = vehicles.id
    where vehicles.id = marketplace_offers.vehicle_id
      and (vehicles.owner_id = auth.uid() or access.user_id = auth.uid())
  )
);
