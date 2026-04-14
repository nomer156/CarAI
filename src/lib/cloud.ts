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
  owner_id: string;
  brand: string;
  model: string;
  model_year: number;
  vin: string;
  owner_code: string | null;
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
  installation_source: 'self' | 'service' | null;
  installed_at: string | null;
  installed_mileage_km: number | null;
  next_replacement_km: number | null;
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
  owner_code: string | null;
  customer_name: string;
  car_label: string;
  work_type: string;
  scheduled_at: string;
  status: 'new' | 'confirmed' | 'in_service' | 'ready';
};

type CloudClientRow = {
  id: string;
  owner_code: string;
  customer_name: string;
  customer_phone: string | null;
  car_label: string;
  last_visit: string;
};

function extractErrorText(error: unknown) {
  if (!error) return '';
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message ?? '');
  return String(error);
}

export function humanizeCloudError(error: unknown) {
  const message = extractErrorText(error);

  if (!message) {
    return 'Не удалось выполнить действие в облаке.';
  }

  if (message.includes('Supabase is not configured')) {
    return 'Облако еще не подключено для этой сборки.';
  }

  if (message.includes('Not authenticated')) {
    return 'Сессия истекла. Войдите снова через Google.';
  }

  if (message.includes('Vehicle not found')) {
    return 'Автомобиль по этому ID не найден.';
  }

  if (message.includes('Service center not found')) {
    return 'Для этого аккаунта еще не назначено СТО.';
  }

  if (message.includes('Insufficient permissions')) {
    return 'Недостаточно прав для этого действия.';
  }

  if (message.includes('duplicate key value') || message.includes('409')) {
    return 'Такие данные уже существуют. Проверьте VIN, номер или повторите попытку с другими значениями.';
  }

  if (message.includes('invalid input syntax for type date')) {
    return 'Дата осмотра заполнена неверно. Используйте формат ГГГГ-ММ-ДД или оставьте поле пустым.';
  }

  if (message.includes('infinite recursion detected in policy')) {
    return 'В базе еще не применено исправление прав доступа. Выполните последний SQL-файл в Supabase.';
  }

  if (message.includes('delete_my_account_data')) {
    return 'Функция удаления еще не обновилась в Supabase. Повторите после применения последней миграции.';
  }

  return message;
}

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

function isMissingDeleteRpc(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && 'message' in error
    && (error as { code?: string }).code === 'PGRST202'
    && String((error as { message?: string }).message).includes('delete_my_account_data'),
  );
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
    installationSource: row.installation_source === 'self' ? 'self' : 'service',
    installedAt: row.installed_at,
    installedMileageKm: row.installed_mileage_km,
    nextReplacementKm: row.next_replacement_km,
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

    const [
      { data: serviceCenter, error: serviceCenterError },
      { data: queueRows, error: queueError },
      { data: clientRows, error: clientsError },
    ] = await Promise.all([
      supabase
        .from('service_centers')
        .select('id, name, city, bays')
        .eq('id', membership.service_center_id)
        .maybeSingle<CloudServiceCenterRow>(),
      supabase
        .from('service_queue')
        .select('id, owner_code, customer_name, car_label, work_type, scheduled_at, status')
        .eq('service_center_id', membership.service_center_id)
        .order('scheduled_at', { ascending: true }),
      supabase
        .from('service_clients')
        .select('id, owner_code, customer_name, customer_phone, car_label, last_visit')
        .eq('service_center_id', membership.service_center_id)
        .order('last_visit', { ascending: false }),
    ]);

    if (serviceCenterError) {
      throw serviceCenterError;
    }

    if (queueError) {
      throw queueError;
    }

    if (clientsError) {
      throw clientsError;
    }

    if (!serviceCenter) {
      return baseState;
    }

    const mappedQueue = ((queueRows ?? []) as CloudQueueRow[]).map((row) => ({
      id: row.id,
      customer: row.customer_name,
      ownerCode: row.owner_code ?? 'CLOUD',
      carLabel: row.car_label,
      workType: row.work_type,
      scheduledAt: formatCloudDateTime(row.scheduled_at),
      status: row.status,
    }));

    const mappedClients = ((clientRows ?? []) as CloudClientRow[]).map((row) => ({
      id: row.id,
      name: row.customer_name,
      ownerCode: row.owner_code,
      phone: row.customer_phone ?? 'Не указан',
      carLabel: row.car_label,
      lastVisit: row.last_visit,
      serviceCenter: serviceCenter.name,
    }));

    return {
      ...baseState,
      serviceCenter: {
        name: serviceCenter.name,
        city: serviceCenter.city ?? 'Не указан',
        address: `${serviceCenter.city ?? 'Город не указан'}, центральный адрес`,
        phone: '+7 (495) 555-00-00',
        workingHours: '08:00 - 21:00',
        bays: serviceCenter.bays,
        activeOrders: mappedQueue.filter((item) => item.status === 'in_service').length,
        queueDepth: mappedQueue.filter((item) => item.status !== 'ready').length,
      },
      clients: mappedClients.length > 0 ? mappedClients : baseState.clients,
      serviceQueue: mappedQueue.length > 0 ? mappedQueue : baseState.serviceQueue,
    };
  }

  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, owner_id, brand, model, model_year, vin, owner_code, plate, mileage_km, engine, color, next_inspection')
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
    supabase.from('parts').select('id, name, oem, manufacturer, price, status, note, installation_source, installed_at, installed_mileage_km, next_replacement_km').eq('vehicle_id', vehicle.id),
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
      ownerCode: vehicle.owner_code ?? vehicle.owner_id,
      mileageKm: vehicle.mileage_km,
      engine: vehicle.engine ?? 'Не указано',
      plate: vehicle.plate ?? 'Не указан',
      color: vehicle.color ?? 'Белый',
      nextInspection: vehicle.next_inspection ?? 'Не назначен',
    },
    cars: [
      {
        id: vehicle.id,
        name: `${vehicle.brand} ${vehicle.model}`.trim(),
        brand: vehicle.brand,
        model: vehicle.model,
      },
    ],
    activeCarId: vehicle.id,
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
  nextInspection?: string | null;
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
    vehicle_plate: input.plate.trim() || null,
    vehicle_mileage_km: input.mileageKm,
    vehicle_engine: input.engine.trim() || null,
    vehicle_color: input.color,
    vehicle_next_inspection: input.nextInspection?.trim() ? input.nextInspection.trim() : null,
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
    if (isMissingDeleteRpc(error)) {
      return;
    }
    throw error;
  }
}

export async function upsertVehiclePart(input: {
  ownerCode?: string;
  partId?: string | null;
  name: string;
  oem: string;
  manufacturer: string;
  price: number;
  status: 'ok' | 'watch' | 'replace';
  note: string;
  installationSource: 'self' | 'service';
  installedAt?: string | null;
  installedMileageKm?: number | null;
  nextReplacementKm?: number | null;
}) {
  if (!supabase || !isSupabaseEnabled) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.rpc('upsert_vehicle_part', {
    target_owner_code: input.ownerCode ?? null,
    target_part_id: input.partId ?? null,
    part_name: input.name,
    part_oem: input.oem,
    part_manufacturer: input.manufacturer,
    part_price: input.price,
    part_status: input.status,
    part_note: input.note,
    part_source: input.installationSource,
    part_installed_at: input.installedAt ?? null,
    part_installed_mileage_km: input.installedMileageKm ?? null,
    part_next_replacement_km: input.nextReplacementKm ?? null,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function addServiceRecordByOwnerCode(input: {
  ownerCode: string;
  title: string;
  details?: string;
  location?: string;
}) {
  if (!supabase || !isSupabaseEnabled) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.rpc('add_service_record_by_owner_code', {
    target_owner_code: input.ownerCode,
    record_title: input.title,
    record_details: input.details ?? null,
    record_location: input.location ?? null,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function addVehicleToServiceIntake(input: {
  ownerCode: string;
  workType?: string;
  customerPhone?: string;
}) {
  if (!supabase || !isSupabaseEnabled) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.rpc('add_vehicle_to_service_intake', {
    target_owner_code: input.ownerCode,
    requested_work_type: input.workType ?? 'Новая запись по owner-коду',
    customer_phone: input.customerPhone ?? null,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function updateServiceQueueStatus(input: {
  queueId: string;
  status: 'new' | 'confirmed' | 'in_service' | 'ready';
}) {
  if (!supabase || !isSupabaseEnabled) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.rpc('update_service_queue_status', {
    target_queue_id: input.queueId,
    next_status: input.status,
  });

  if (error) {
    throw error;
  }

  return data;
}
