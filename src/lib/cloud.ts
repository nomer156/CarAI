import type { Session } from '@supabase/supabase-js';
import { demoState } from '../data/demoData';
import type {
  AccidentRecord,
  ApprovalStatus,
  DocumentRecord,
  GarageState,
  MaintenanceTask,
  MarketplaceOffer,
  Part,
  ServiceRecord,
  UserRole,
} from '../types';
import { isSupabaseEnabled, supabase } from './supabase';

export { isSupabaseEnabled } from './supabase';

type CloudVehicleRow = {
  id: string;
  brand: string;
  model: string;
  model_year: number;
  vin: string;
  plate: string | null;
  mileage_km: number;
  engine: string | null;
  color: string | null;
  next_inspection: string | null;
};

type CloudPartRow = {
  id: string;
  name: string;
  oem: string;
  manufacturer: string | null;
  price: number | null;
  status: 'ok' | 'watch' | 'replace';
  note: string | null;
};

type CloudMaintenanceRow = {
  id: string;
  title: string;
  due_at_km: number;
  last_done_km: number;
  interval_km: number;
  priority: 'low' | 'medium' | 'high';
  notes: string | null;
};

type CloudServiceRow = {
  id: string;
  service_date: string;
  title: string;
  location: string | null;
  details: string | null;
  verified: boolean;
};

type CloudAccidentRow = {
  id: string;
  event_date: string;
  title: string;
  severity: 'minor' | 'moderate' | 'serious';
  details: string | null;
};

type CloudDocumentRow = {
  id: string;
  title: string;
  category: 'insurance' | 'inspection' | 'invoice' | 'manual';
  issued_at: string;
  expires_at: string | null;
  verified: boolean;
};

type CloudOfferRow = {
  id: string;
  part_id: string;
  seller: string;
  condition: 'new' | 'oem' | 'aftermarket';
  price: number;
  eta_days: number;
};

type CloudUserRow = {
  id: string;
  role: UserRole;
  approval_status: ApprovalStatus;
  full_name: string;
};

type CloudStaffMembershipRow = {
  service_center_id: string;
  specialization: string | null;
  shift_label: string | null;
  is_active: boolean;
};

type CloudServiceCenterRow = {
  id: string;
  name: string;
  city: string | null;
  bays: number;
};

type CloudQueueRow = {
  id: string;
  customer_name: string;
  car_label: string;
  work_type: string;
  scheduled_at: string;
  status: 'new' | 'confirmed' | 'in_service' | 'ready';
};

function getAuthRedirectOrigin() {
  return window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5173'
    : window.location.origin;
}

export async function signInWithMagicLink(email: string) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: getAuthRedirectOrigin(),
    },
  });

  if (error) {
    throw error;
  }
}

export async function signInWithGoogle() {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: getAuthRedirectOrigin(),
    },
  });

  if (error) {
    throw error;
  }
}

export async function signOutCloud() {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function getCurrentSession() {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }

  return data.session;
}

export function subscribeToAuthChanges(callback: (session: Session | null) => void) {
  if (!supabase) {
    return () => undefined;
  }

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return () => data.subscription.unsubscribe();
}

function mapParts(rows: CloudPartRow[]): Part[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    oem: row.oem,
    manufacturer: row.manufacturer ?? 'Не указан',
    price: row.price ?? 0,
    status: row.status,
    note: row.note ?? '',
    installationSource: 'service',
  }));
}

function mapMaintenance(rows: CloudMaintenanceRow[]): MaintenanceTask[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    dueAtKm: row.due_at_km,
    lastDoneKm: row.last_done_km,
    intervalKm: row.interval_km,
    priority: row.priority,
    notes: row.notes ?? '',
    items: [],
  }));
}

function mapServices(rows: CloudServiceRow[]): ServiceRecord[] {
  return rows.map((row) => ({
    id: row.id,
    date: row.service_date,
    title: row.title,
    location: row.location ?? 'Не указано',
    mechanic: 'Механик Supabase',
    verified: row.verified,
    details: row.details ?? '',
  }));
}

function mapAccidents(rows: CloudAccidentRow[]): AccidentRecord[] {
  return rows.map((row) => ({
    id: row.id,
    date: row.event_date,
    title: row.title,
    severity: row.severity,
    details: row.details ?? '',
  }));
}

function mapDocuments(rows: CloudDocumentRow[]): DocumentRecord[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at ?? undefined,
    verified: row.verified,
  }));
}

function mapOffers(rows: CloudOfferRow[]): MarketplaceOffer[] {
  return rows.map((row) => ({
    id: row.id,
    partId: row.part_id,
    seller: row.seller,
    condition: row.condition,
    price: row.price,
    etaDays: row.eta_days,
  }));
}

function buildBaseState(profile: CloudUserRow): GarageState {
  return {
    ...demoState,
    role: profile.role,
    approvalStatus: profile.approval_status,
    ownerName: profile.role === 'owner' ? profile.full_name : demoState.ownerName,
    mechanicName: profile.role === 'mechanic' ? profile.full_name : demoState.mechanicName,
  };
}

function formatCloudDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function loadGarageStateFromCloud() {
  if (!supabase || !isSupabaseEnabled) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, role, approval_status, full_name')
    .maybeSingle<CloudUserRow>();

  if (profileError) {
    throw profileError;
  }

  if (!profile) {
    return null;
  }

  const baseState = buildBaseState(profile);

  if (profile.role !== 'owner') {
    const { data: membership, error: membershipError } = await supabase
      .from('service_center_staff')
      .select('service_center_id, specialization, shift_label, is_active')
      .eq('user_id', profile.id)
      .maybeSingle<CloudStaffMembershipRow>();

    if (membershipError) {
      throw membershipError;
    }

    if (!membership?.service_center_id) {
      return baseState;
    }

    const [{ data: serviceCenter, error: serviceCenterError }, { data: queueRows, error: queueError }] = await Promise.all([
      supabase
        .from('service_centers')
        .select('id, name, city, bays')
        .eq('id', membership.service_center_id)
        .maybeSingle<CloudServiceCenterRow>(),
      supabase
        .from('service_queue')
        .select('id, customer_name, car_label, work_type, scheduled_at, status')
        .eq('service_center_id', membership.service_center_id)
        .order('scheduled_at', { ascending: true }),
    ]);

    if (serviceCenterError) {
      throw serviceCenterError;
    }

    if (queueError) {
      throw queueError;
    }

    if (!serviceCenter) {
      return baseState;
    }

    const mappedQueue = ((queueRows ?? []) as CloudQueueRow[]).map((row) => ({
      id: row.id,
      customer: row.customer_name,
      carLabel: row.car_label,
      workType: row.work_type,
      scheduledAt: formatCloudDateTime(row.scheduled_at),
      status: row.status,
    }));

    return {
      ...baseState,
      serviceCenter: {
        name: serviceCenter.name,
        city: serviceCenter.city ?? 'Не указан',
        bays: serviceCenter.bays,
        activeOrders: mappedQueue.filter((item) => item.status === 'in_service').length,
        queueDepth: mappedQueue.filter((item) => item.status !== 'ready').length,
      },
      serviceQueue: mappedQueue.length > 0 ? mappedQueue : baseState.serviceQueue,
    };
  }

  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, brand, model, model_year, vin, plate, mileage_km, engine, color, next_inspection')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<CloudVehicleRow>();

  if (vehicleError) {
    throw vehicleError;
  }

  if (!vehicle) {
    return baseState;
  }

  const [
    partsResult,
    maintenanceResult,
    recordsResult,
    accidentsResult,
    documentsResult,
    offersResult,
  ] = await Promise.all([
    supabase.from('parts').select('id, name, oem, manufacturer, price, status, note').eq('vehicle_id', vehicle.id),
    supabase
      .from('maintenance_tasks')
      .select('id, title, due_at_km, last_done_km, interval_km, priority, notes')
      .eq('vehicle_id', vehicle.id),
    supabase
      .from('service_records')
      .select('id, service_date, title, location, details, verified')
      .eq('vehicle_id', vehicle.id)
      .order('service_date', { ascending: false }),
    supabase
      .from('accident_records')
      .select('id, event_date, title, severity, details')
      .eq('vehicle_id', vehicle.id)
      .order('event_date', { ascending: false }),
    supabase
      .from('documents')
      .select('id, title, category, issued_at, expires_at, verified')
      .eq('vehicle_id', vehicle.id)
      .order('issued_at', { ascending: false }),
    supabase
      .from('marketplace_offers')
      .select('id, part_id, seller, condition, price, eta_days')
      .eq('vehicle_id', vehicle.id)
      .order('price', { ascending: true }),
  ]);

  const responses = [
    partsResult,
    maintenanceResult,
    recordsResult,
    accidentsResult,
    documentsResult,
    offersResult,
  ];

  const failedResponse = responses.find((response) => response.error);
  if (failedResponse?.error) {
    throw failedResponse.error;
  }

  return {
    ...baseState,
    vehicle: {
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.model_year,
      vin: vehicle.vin,
      mileageKm: vehicle.mileage_km,
      engine: vehicle.engine ?? 'Не указано',
      plate: vehicle.plate ?? 'Не указан',
      color: vehicle.color ?? 'Graphite Gray',
      nextInspection: vehicle.next_inspection ?? 'Не назначен',
    },
    parts: mapParts((partsResult.data ?? []) as CloudPartRow[]),
    maintenance: mapMaintenance((maintenanceResult.data ?? []) as CloudMaintenanceRow[]),
    records: mapServices((recordsResult.data ?? []) as CloudServiceRow[]),
    accidents: mapAccidents((accidentsResult.data ?? []) as CloudAccidentRow[]),
    documents: mapDocuments((documentsResult.data ?? []) as CloudDocumentRow[]),
    offers: mapOffers((offersResult.data ?? []) as CloudOfferRow[]),
  } satisfies GarageState;
}

export async function bootstrapDemoGarage(profileName: string, profileRole: 'owner' | 'mechanic') {
  if (!supabase || !isSupabaseEnabled) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.rpc('bootstrap_demo_garage', {
    profile_name: profileName,
    profile_role: profileRole,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function bootstrapStaffAccount(
  profileName: string,
  profileRole: 'service_admin' | 'company_admin',
  serviceCenterName = 'Nord Garage',
  serviceCenterCity = 'Москва',
) {
  if (!supabase || !isSupabaseEnabled) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.rpc('bootstrap_staff_account', {
    profile_name: profileName,
    profile_role: profileRole,
    service_center_name: serviceCenterName,
    service_center_city: serviceCenterCity,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function saveOwnerProfile(input: {
  profileName: string;
  brand: string;
  model: string;
  year: number;
  vin: string;
  plate: string;
  mileageKm: number;
  engine: string;
  color: string;
  nextInspection: string;
}) {
  if (!supabase || !isSupabaseEnabled) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.rpc('save_owner_profile', {
    profile_name: input.profileName,
    vehicle_brand: input.brand,
    vehicle_model: input.model,
    vehicle_year: input.year,
    vehicle_vin: input.vin,
    vehicle_plate: input.plate,
    vehicle_mileage_km: input.mileageKm,
    vehicle_engine: input.engine,
    vehicle_color: input.color,
    vehicle_next_inspection: input.nextInspection,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function saveStaffProfile(input: {
  profileName: string;
  role: 'service_admin' | 'company_admin';
  serviceCenterName: string;
  serviceCenterCity: string;
  serviceCenterBays: number;
}) {
  if (!supabase || !isSupabaseEnabled) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.rpc('save_staff_profile', {
    profile_name: input.profileName,
    profile_role: input.role,
    service_center_name: input.serviceCenterName,
    service_center_city: input.serviceCenterCity,
    service_center_bays: input.serviceCenterBays,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function deleteCloudAccountData() {
  if (!supabase || !isSupabaseEnabled) {
    throw new Error('Supabase is not configured.');
  }

  const { error } = await supabase.rpc('delete_my_account_data');
  if (error) {
    throw error;
  }
}
