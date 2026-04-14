import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Session } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import {
  BadgeCheck,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  ChevronUp,
  Cog,
  Download,
  Gauge,
  LogIn,
  Moon,
  Pencil,
  Plus,
  Save,
  ScanLine,
  ShieldCheck,
  SunMedium,
  Trash2,
  TriangleAlert,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { availableCarColors, resolveCarVisual, vehicleBrandOptions } from './data/carCatalog';
import { demoState } from './data/demoData';
import {
  findServiceCatalogItem,
  getServiceAssemblies,
  getServiceCatalogItem,
  getServiceSubAssemblies,
  serviceCatalog,
  suggestServiceCatalogItems,
} from './data/serviceCatalog';
import { buildMaintenanceTemplateForVehicle, resolveVehicleDefaults } from './data/vehiclePresets';
import {
  addServiceRecordByOwnerCode,
  addVehicleToServiceIntake,
  bootstrapDemoGarage,
  deleteCloudAccountData,
  getCurrentSession,
  humanizeCloudError,
  isSupabaseEnabled,
  loadGarageStateFromCloud,
  saveOwnerProfile,
  saveStaffProfile,
  signInWithGoogle,
  signOutCloud,
  subscribeToAuthChanges,
  updateServiceQueueStatus,
  upsertVehiclePart,
} from './lib/cloud';
import { clearGarageState, loadGarageState, saveGarageState } from './lib/db';
import type { GarageState, JournalRecord, MaintenanceTask, Part, ServiceRecord, StaffMember, UserRole } from './types';

type TabKey = 'overview' | 'parts' | 'maintenance' | 'history';
type ThemeMode = 'light' | 'dark';
type StaffRoleOption = 'mechanic' | 'staff' | 'service_admin';
type PartDraft = {
  name: string;
  oem: string;
  manufacturer: string;
  price: string;
  note: string;
  installedAt: string;
  installedMileageKm: string;
  nextReplacementKm: string;
  status: 'ok' | 'watch' | 'replace';
};
type QuickEntryDraft = {
  note: string;
  occurredAt: string;
  mileage: string;
  assembly: string;
  subAssembly: string;
  partName: string;
  catalogItemId?: string;
  cost: string;
  nextMileage: string;
  rating?: 'good' | 'bad';
};
type QuickEntryPreset = {
  id: string;
  label: string;
  catalogItemId: string;
  hint: string;
};
type MaintenanceEditDraft = {
  lastDoneKm: string;
};

const ownerTabs = ['overview', 'parts', 'maintenance', 'history'] as const;
const mechanicTabs = ['overview', 'parts', 'maintenance', 'history'] as const;
const serviceAdminTabs = ['overview', 'maintenance', 'history'] as const;
const companyAdminTabs = ['overview', 'maintenance', 'history'] as const;
const APP_VERSION = 'v0.2';
const consumableCatalogIds = new Set([
  'engine-oil',
  'oil-filter',
  'air-filter',
  'fuel-filter',
  'spark-plugs',
  'coolant',
  'gearbox-oil-manual',
  'gearbox-oil-auto',
  'gearbox-filter-auto',
  'brake-fluid',
  'cabin-filter',
  'wiper-blades',
]);
const quickEntryPresets: QuickEntryPreset[] = [
  {
    id: 'engine-oil',
    label: 'Масло двигателя',
    catalogItemId: 'engine-oil',
    hint: 'Подходит для быстрой записи масла, фильтра и следующего рубежа по пробегу.',
  },
  {
    id: 'gearbox-oil-auto',
    label: 'Масло коробки',
    catalogItemId: 'gearbox-oil-auto',
    hint: 'Быстрый шаблон для масла АКПП. При необходимости вручную переключите узел на МКПП.',
  },
  {
    id: 'brake-fluid',
    label: 'Тормозная жидкость',
    catalogItemId: 'brake-fluid',
    hint: 'Подходит для регулярной сервисной записи с понятным следующим интервалом.',
  },
  {
    id: 'cabin-filter',
    label: 'Фильтры',
    catalogItemId: 'cabin-filter',
    hint: 'Хороший шаблон для сезонного обслуживания и мелких расходников без лишних тапов.',
  },
  {
    id: 'coolant',
    label: 'Антифриз',
    catalogItemId: 'coolant',
    hint: 'Удобно фиксировать промывку системы и замену охлаждающей жидкости вместе с пробегом.',
  },
];

const maintenanceMatchers: Array<{ id: string; patterns: RegExp[] }> = [
  { id: 'oil-service', patterns: [/масл/i, /oil/i] },
  { id: 'filters-service', patterns: [/фильтр/i] },
  { id: 'brake-service', patterns: [/колодк/i, /диск/i, /тормоз/i] },
  { id: 'brake-fluid', patterns: [/тормозн.*жидк/i] },
  { id: 'spark-service', patterns: [/свеч/i, /зажиган/i] },
  { id: 'coolant-service', patterns: [/антифриз/i, /охлаждающ/i] },
  { id: 'transmission-service', patterns: [/акпп/i, /мкпп/i, /короб/i, /трансмисс/i] },
  { id: 'timing-service', patterns: [/грм/i, /цеп/i, /ролик/i] },
];

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
}

function formatTimelineDate(value: number) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(value);
}

function formatLongDate(value?: string | null) {
  if (!value) return 'Не указано';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
}

function toOptionalNumber(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function maintenanceProgress(task: MaintenanceTask, mileageKm: number) {
  const traveled = mileageKm - task.lastDoneKm;
  return Math.min(Math.max((traveled / task.intervalKm) * 100, 0), 100);
}

function remainingMileage(task: MaintenanceTask, mileageKm: number) {
  return Math.max(task.dueAtKm - mileageKm, 0);
}

function maintenanceUrgency(task: MaintenanceTask, mileageKm: number) {
  const remaining = task.dueAtKm - mileageKm;
  if (remaining <= 0) return 'danger';
  if (remaining <= task.intervalKm * 0.2) return 'warning';
  return 'ok';
}

function maintenanceUrgencyLabel(task: MaintenanceTask, mileageKm: number) {
  const urgency = maintenanceUrgency(task, mileageKm);
  if (urgency === 'danger') return 'Пора менять';
  if (urgency === 'warning') return 'Скоро замена';
  return 'Запас есть';
}

function emptyQuickEntryDraft(): QuickEntryDraft {
  return {
    note: '',
    occurredAt: todayInputValue(),
    mileage: '',
    assembly: '',
    subAssembly: '',
    partName: '',
    cost: '',
    nextMileage: '',
  };
}

function emptyPartDraft(defaultMileage?: number): PartDraft {
  return {
    name: '',
    oem: '',
    manufacturer: '',
    price: '',
    note: '',
    installedAt: todayInputValue(),
    installedMileageKm: defaultMileage ? String(defaultMileage) : '',
    nextReplacementKm: '',
    status: 'ok',
  };
}

function generateStableVin(seed: string) {
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  const compact = seed.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'CODEXCARSEED';
  let result = 'ZZZ';
  for (let index = 0; result.length < 17; index += 1) {
    const sourceCode = compact.charCodeAt(index % compact.length);
    result += alphabet[sourceCode % alphabet.length];
  }
  return result.slice(0, 17);
}

function partSourceLabel(source: Part['installationSource']) {
  return source === 'self' ? 'От владельца' : 'Подтверждено СТО';
}

function partStatusLabel(status: Part['status']) {
  if (status === 'ok') return 'Норма';
  if (status === 'watch') return 'Контроль';
  return 'Замена';
}

function queueStatusLabel(status: GarageState['serviceQueue'][number]['status']) {
  if (status === 'confirmed') return 'Подтвержден';
  if (status === 'in_service') return 'В работе';
  if (status === 'ready') return 'Готово';
  return 'Новая запись';
}

function buildLocalCar(current: GarageState) {
  const fallbackId = current.activeCarId || `car-${Date.now()}`;
  const fallbackName = `${current.vehicle.brand} ${current.vehicle.model}`.trim() || 'Мой автомобиль';
  if (current.cars.length) {
    return { cars: current.cars, activeCarId: current.activeCarId || current.cars[0].id };
  }
  return {
    cars: [{ id: fallbackId, name: fallbackName, brand: current.vehicle.brand, model: current.vehicle.model }],
    activeCarId: fallbackId,
  };
}

function updateMaintenanceTasks(tasks: MaintenanceTask[], mileageKm: number, occurredAt: string, subject: string, matchedTaskId?: string) {
  const matchId = matchedTaskId ?? maintenanceMatchers.find((item) => item.patterns.some((pattern) => pattern.test(subject)))?.id;
  if (!matchId) return tasks;
  return tasks.map((task) => (task.id === matchId ? {
    ...task,
    lastDoneKm: mileageKm,
    dueAtKm: mileageKm + task.intervalKm,
    notes: `Последняя отметка: ${formatLongDate(occurredAt)} • ${subject}.`,
  } : task));
}

function composeQuickEntryNote(draft: QuickEntryDraft, fallbackPartName?: string) {
  const manualNote = draft.note.trim();
  if (manualNote) return manualNote;
  const partName = fallbackPartName ?? draft.partName.trim();
  if (partName) return `Обслуживание: ${partName}`;
  return '';
}

function buildQuickEntryPath(draft: QuickEntryDraft, fallbackAssembly?: string, fallbackSubAssembly?: string) {
  return {
    assembly: fallbackAssembly ?? (draft.assembly.trim() || undefined),
    subAssembly: fallbackSubAssembly ?? (draft.subAssembly.trim() || undefined),
  };
}

function applyVehiclePresetState(current: GarageState, brand: string, model: string, referenceDate = todayInputValue()) {
  const defaults = resolveVehicleDefaults(brand, model, referenceDate);
  const nextMileage = current.vehicle.mileageKm > 0 ? current.vehicle.mileageKm : defaults.defaultMileageKm;
  const nextMaintenance = buildMaintenanceTemplateForVehicle(brand, model, nextMileage, referenceDate);
  const nextCarName = `${brand} ${model}`.trim();

  return {
    ...current,
    cars: current.cars.length
      ? current.cars.map((car) => car.id === current.activeCarId ? { ...car, brand, model, name: nextCarName } : car)
      : current.cars,
    vehicle: {
      ...current.vehicle,
      brand,
      model,
      mileageKm: nextMileage,
      engine: defaults.engine,
      nextInspection: current.vehicle.nextInspection || defaults.nextInspection,
    },
    maintenance: nextMaintenance,
  };
}

function hydrateMaintenancePlan(tasks: MaintenanceTask[], brand: string, model: string, mileageKm: number) {
  const basePlan = buildMaintenanceTemplateForVehicle(brand, model, mileageKm);
  if (!tasks.length) return basePlan;
  return basePlan.map((baseTask) => {
    const currentTask = tasks.find((task) => task.id === baseTask.id);
    return currentTask ? {
      ...baseTask,
      ...currentTask,
      items: baseTask.items,
      notes: currentTask.notes || baseTask.notes,
    } : baseTask;
  });
}

function findQuickEntryCatalogItem(draft: QuickEntryDraft) {
  return getServiceCatalogItem(draft.catalogItemId)
    ?? findServiceCatalogItem(draft.partName, draft.assembly, draft.subAssembly);
}

function emptyMaintenanceEditDraft(task?: MaintenanceTask): MaintenanceEditDraft {
  return {
    lastDoneKm: task ? String(task.lastDoneKm) : '',
  };
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function App() {
  const [state, setState] = useState<GarageState>(demoState);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = window.localStorage.getItem('codexcar-theme');
    return saved === 'dark' || saved === 'light' ? saved : 'light';
  });
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [syncStatus, setSyncStatus] = useState(
    isSupabaseEnabled
      ? 'Войдите через Google, чтобы открыть профиль автомобиля и общую сервисную историю.'
      : 'Облако не настроено. Локальный журнал и паспорт авто работают без него.',
  );
  const [hasCloudProfile, setHasCloudProfile] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDemoModeOpen, setIsDemoModeOpen] = useState(false);
  const [isPassportExpanded, setIsPassportExpanded] = useState(true);
  const [isVehicleEditorOpen, setIsVehicleEditorOpen] = useState(false);
  const [expandedMaintenanceId, setExpandedMaintenanceId] = useState<string | null>('oil-service');
  const [quickEntryDraft, setQuickEntryDraft] = useState<QuickEntryDraft>(emptyQuickEntryDraft());
  const [isQuickEntryExpanded, setIsQuickEntryExpanded] = useState(false);
  const [isSavingQuickEntry, setIsSavingQuickEntry] = useState(false);
  const [editingJournalId, setEditingJournalId] = useState<string | null>(null);
  const [editingMaintenanceId, setEditingMaintenanceId] = useState<string | null>(null);
  const [maintenanceEditDraft, setMaintenanceEditDraft] = useState<MaintenanceEditDraft>(emptyMaintenanceEditDraft());
  const [activeQuickHintId, setActiveQuickHintId] = useState<string | null>(null);
  const [swipedRecordId, setSwipedRecordId] = useState<string | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [profileName, setProfileName] = useState('');
  const [serviceCenterName, setServiceCenterName] = useState('');
  const [serviceCenterCity, setServiceCenterCity] = useState('');
  const [serviceCenterBays, setServiceCenterBays] = useState('');
  const [ownerPartDraft, setOwnerPartDraft] = useState<PartDraft>(emptyPartDraft());
  const [ownerPartAssembly, setOwnerPartAssembly] = useState('');
  const [ownerPartSubAssembly, setOwnerPartSubAssembly] = useState('');
  const [ownerPartCatalogId, setOwnerPartCatalogId] = useState<string | undefined>();
  const [servicePartDraft, setServicePartDraft] = useState<PartDraft>(emptyPartDraft());
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [editingPartDraft, setEditingPartDraft] = useState<PartDraft>(emptyPartDraft());
  const [employeeDraft, setEmployeeDraft] = useState({ name: '', role: 'mechanic' as StaffRoleOption, specialization: '', shift: '', workplace: '', salaryRub: '' });
  const [clientLookupCode, setClientLookupCode] = useState('');
  const [ownerQrCode, setOwnerQrCode] = useState('');
  const [isScanningQr, setIsScanningQr] = useState(false);
  const [activeServiceOwnerCode, setActiveServiceOwnerCode] = useState('');
  const [serviceWorkTitle, setServiceWorkTitle] = useState('');
  const [serviceWorkDetails, setServiceWorkDetails] = useState('');
  const quickEntryRef = useRef<HTMLElement | null>(null);
  const quickEntryInputRef = useRef<HTMLInputElement | null>(null);
  const passportRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    loadGarageState().then((loadedState) => {
      if (loadedState.role === 'owner' && loadedState.vehicle.brand && loadedState.vehicle.model) {
        const mileageKm = loadedState.vehicle.mileageKm || resolveVehicleDefaults(loadedState.vehicle.brand, loadedState.vehicle.model).defaultMileageKm;
        setState({
          ...loadedState,
          vehicle: { ...loadedState.vehicle, mileageKm },
          maintenance: hydrateMaintenancePlan(loadedState.maintenance, loadedState.vehicle.brand, loadedState.vehicle.model, mileageKm),
        });
        return;
      }
      setState(loadedState);
    }).catch(() => setState(demoState));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem('codexcar-theme', themeMode);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeMode === 'dark' ? '#111f29' : '#f5f1e8');
  }, [themeMode]);

  useEffect(() => {
    if (state.role === 'owner') setProfileName(state.ownerName);
    if (state.role === 'mechanic') setProfileName(state.mechanicName);
    if (state.role === 'service_admin' || state.role === 'company_admin') {
      setProfileName('');
      setServiceCenterName(state.serviceCenter.name);
      setServiceCenterCity(state.serviceCenter.city);
      setServiceCenterBays(state.serviceCenter.bays ? String(state.serviceCenter.bays) : '');
    }
  }, [state.role, state.ownerName, state.mechanicName, state.serviceCenter.name, state.serviceCenter.city, state.serviceCenter.bays]);

  useEffect(() => {
    saveGarageState(state).catch(() => undefined);
  }, [state]);

  useEffect(() => {
    const code = state.vehicle.ownerCode || session?.user?.id || '';
    if (!code) {
      setOwnerQrCode('');
      return;
    }
    QRCode.toDataURL(code, {
      width: 176,
      margin: 1,
      color: {
        dark: themeMode === 'dark' ? '#0f2533' : '#173042',
        light: '#ffffff',
      },
    }).then(setOwnerQrCode).catch(() => setOwnerQrCode(''));
  }, [state.vehicle.ownerCode, session?.user?.id, themeMode]);

  useEffect(() => {
    if (!isSupabaseEnabled) {
      setIsAuthReady(true);
      return;
    }

    getCurrentSession().then(async (next) => {
      setSession(next);
      if (!next) {
        setHasCloudProfile(false);
        setIsAuthReady(true);
        return;
      }

      const cloudState = await loadGarageStateFromCloud();
      if (cloudState) {
        setState((current) => mergeLocalOwnerState(current, cloudState));
        setHasCloudProfile(true);
        setSyncStatus('Профиль и автомобиль загружены из облака.');
      } else {
        setProfileName(next.user?.user_metadata?.full_name ?? '');
        setHasCloudProfile(false);
      }
      setIsAuthReady(true);
    }).catch((error: Error) => {
      setSyncStatus(humanizeCloudError(error));
      setIsAuthReady(true);
    });

    return subscribeToAuthChanges((next) => {
      setSession(next);
      if (!next?.user?.email) {
        setHasCloudProfile(false);
        setIsAuthReady(true);
        setSyncStatus('Вы не вошли.');
        return;
      }
      setSyncStatus(`Вы вошли как ${next.user.email}.`);
      setIsAuthReady(true);
      void loadGarageStateFromCloud().then((cloudState) => {
        if (cloudState) {
          setState((current) => mergeLocalOwnerState(current, cloudState));
          setHasCloudProfile(true);
        } else {
          setHasCloudProfile(false);
          setProfileName(next.user?.user_metadata?.full_name ?? '');
        }
      }).catch((error) => setSyncStatus(humanizeCloudError(error)));
    });
  }, []);

  useEffect(() => {
    if (!isAuthReady || state.role !== 'owner') return;
    quickEntryInputRef.current?.focus();
  }, [isAuthReady, state.role]);

  useEffect(() => {
    if (!activeQuickHintId) return;
    const timeout = window.setTimeout(() => setActiveQuickHintId(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [activeQuickHintId]);

  const roleLabel = state.role === 'owner' ? 'Владелец' : state.role === 'mechanic' ? 'Механик' : state.role === 'service_admin' ? 'Админ СТО' : 'Модератор';
  const topRoleLabel = session ? roleLabel : 'Гость';
  const currentDisplayName = session
    ? hasCloudProfile
      ? state.role === 'owner'
        ? state.ownerName
        : state.role === 'mechanic'
          ? state.mechanicName
          : session.user?.user_metadata?.full_name ?? profileName
      : session.user?.user_metadata?.full_name ?? profileName
    : 'Сервисный журнал автомобиля';
  const activeCar = state.cars.find((car) => car.id === state.activeCarId) ?? state.cars[0];
  const ownerTimeline = [...state.journal]
    .filter((record) => record.carId === (activeCar?.id ?? state.activeCarId))
    .sort((left, right) => right.createdAt - left.createdAt);
  const selectedBrandOption = vehicleBrandOptions.find((item) => item.brand === state.vehicle.brand) ?? vehicleBrandOptions[0];
  const carVisual = resolveCarVisual(state.vehicle.brand);
  const showOnboarding = isAuthReady && Boolean(session) && !hasCloudProfile;
  const tabs = state.role === 'owner' ? ownerTabs : state.role === 'mechanic' ? mechanicTabs : state.role === 'service_admin' ? serviceAdminTabs : companyAdminTabs;
  const tabLabels: Record<TabKey, string> = state.role === 'owner'
    ? { overview: 'Лента', parts: 'Детали', maintenance: 'Регламент', history: 'СТО' }
    : state.role === 'mechanic'
      ? { overview: 'Смена', parts: 'Детали', maintenance: 'Клиенты', history: 'Работы' }
      : state.role === 'service_admin'
        ? { overview: 'СТО', parts: 'Детали', maintenance: 'Клиенты', history: 'Логи' }
        : { overview: 'Компании', parts: 'Детали', maintenance: 'Люди', history: 'Логи' };
  const ownerSectionMeta: Partial<Record<TabKey, { title: string; text: string }>> = {
    parts: { title: 'Карточки деталей', text: 'OEM, производитель, дата установки, пробег и комментарии по ресурсу в одном месте.' },
    maintenance: { title: 'Регламент и интервалы', text: 'Понятная карта обслуживания по пробегу: когда менять, что проверять и что уже закрыто.' },
    history: { title: 'Подтвержденные работы СТО', text: 'Чистая сервисная история с отметкой проверенных визитов и мастеров.' },
  };
  const verifiedRecords = state.records.filter((record) => record.verified);
  const latestVerifiedRecord = [...verifiedRecords].sort((left, right) => right.date.localeCompare(left.date))[0];
  const nearestMaintenance = [...state.maintenance].sort((left, right) => remainingMileage(left, state.vehicle.mileageKm) - remainingMileage(right, state.vehicle.mileageKm))[0];
  const oilTask = state.maintenance.find((task) => task.id === 'oil-service');
  const brakeTask = state.maintenance.find((task) => task.id === 'brake-service');
  const timingTask = state.maintenance.find((task) => task.id === 'timing-service');
  const consumableCatalogItems = useMemo(() => serviceCatalog.filter((item) => consumableCatalogIds.has(item.id)), []);
  const activeQuickPreset = quickEntryPresets.find((preset) => preset.id === activeQuickHintId) ?? null;
  const activeQuickPresetItem = getServiceCatalogItem(activeQuickPreset?.catalogItemId);
  const assemblyOptions = useMemo(() => [...new Set(consumableCatalogItems.map((item) => item.assembly))], [consumableCatalogItems]);
  const subAssemblyOptions = useMemo(
    () => [...new Set(consumableCatalogItems.filter((item) => !quickEntryDraft.assembly || item.assembly === quickEntryDraft.assembly).map((item) => item.subAssembly))],
    [consumableCatalogItems, quickEntryDraft.assembly],
  );
  const selectedQuickEntryItem = useMemo(() => findQuickEntryCatalogItem(quickEntryDraft), [quickEntryDraft]);
  const quickEntrySuggestions = useMemo(() => suggestServiceCatalogItems(quickEntryDraft.partName, quickEntryDraft.assembly, quickEntryDraft.subAssembly)
    .filter((item) => consumableCatalogIds.has(item.id)), [quickEntryDraft.partName, quickEntryDraft.assembly, quickEntryDraft.subAssembly]);
  const ownerPartSubAssemblyOptions = useMemo(() => getServiceSubAssemblies(ownerPartAssembly), [ownerPartAssembly]);
  const ownerPartSuggestions = useMemo(
    () => suggestServiceCatalogItems(ownerPartDraft.name, ownerPartAssembly, ownerPartSubAssembly),
    [ownerPartDraft.name, ownerPartAssembly, ownerPartSubAssembly],
  );
  const selectedOwnerPartItem = useMemo(
    () => getServiceCatalogItem(ownerPartCatalogId) ?? findServiceCatalogItem(ownerPartDraft.name, ownerPartAssembly, ownerPartSubAssembly),
    [ownerPartCatalogId, ownerPartDraft.name, ownerPartAssembly, ownerPartSubAssembly],
  );
  const urgentParts = useMemo(() => [...state.parts]
    .filter((part) => part.nextReplacementKm && part.nextReplacementKm <= state.vehicle.mileageKm + 3000)
    .sort((left, right) => (left.nextReplacementKm ?? Number.MAX_SAFE_INTEGER) - (right.nextReplacementKm ?? Number.MAX_SAFE_INTEGER)), [state.parts, state.vehicle.mileageKm]);

  function presentCloudError(error: unknown, fallback: string) {
    setSyncStatus(humanizeCloudError(error) || fallback);
  }

  function mergeLocalOwnerState(current: GarageState, cloudState: GarageState) {
    if (cloudState.role !== 'owner') return { ...cloudState, journal: current.journal };
    const mileageKm = cloudState.vehicle.mileageKm || resolveVehicleDefaults(cloudState.vehicle.brand, cloudState.vehicle.model).defaultMileageKm;
    return {
      ...cloudState,
      journal: current.journal,
      maintenance: hydrateMaintenancePlan(cloudState.maintenance, cloudState.vehicle.brand, cloudState.vehicle.model, mileageKm),
      vehicle: { ...cloudState.vehicle, mileageKm },
    };
  }

  function switchRole(role: UserRole) {
    setState((current) => ({ ...current, role, approvalStatus: role === 'mechanic' ? 'pending' : 'approved' }));
    setActiveTab('overview');
  }

  function prepareNewVehicle() {
    const brand = vehicleBrandOptions[0];
    const nextCarId = state.activeCarId || `car-${Date.now()}`;
    const nextDate = todayInputValue();
    setState((current) => {
      const baseState: GarageState = {
        ...current,
        cars: [{ id: nextCarId, name: `${brand.brand} ${brand.models[0]}`, brand: brand.brand, model: brand.models[0] }],
        activeCarId: nextCarId,
        vehicle: { ...current.vehicle, brand: brand.brand, model: brand.models[0], vin: '', plate: '', mileageKm: 0, engine: '', nextInspection: '' },
        journal: [],
        parts: [],
      };
      return applyVehiclePresetState(baseState, brand.brand, brand.models[0], nextDate);
    });
    const defaults = resolveVehicleDefaults(brand.brand, brand.models[0], nextDate);
    setOwnerPartDraft(emptyPartDraft(defaults.defaultMileageKm));
    setOwnerPartAssembly('');
    setOwnerPartSubAssembly('');
    setOwnerPartCatalogId(undefined);
    setQuickEntryDraft(emptyQuickEntryDraft());
    setIsVehicleEditorOpen(true);
    setSyncStatus('Открыта новая машина с предзаполненным регламентом и средним стартовым пробегом.');
  }

  function updateVehicleBrand(brand: string) {
    const option = vehicleBrandOptions.find((item) => item.brand === brand);
    const nextModel = option?.models[0] ?? '';
    setState((current) => applyVehiclePresetState(current, brand, nextModel));
    const defaults = resolveVehicleDefaults(brand, nextModel);
    setOwnerPartDraft((current) => emptyPartDraft(current.installedMileageKm ? Number.parseInt(current.installedMileageKm, 10) : defaults.defaultMileageKm));
    setOwnerPartAssembly('');
    setOwnerPartSubAssembly('');
    setOwnerPartCatalogId(undefined);
  }

  function updateVehicleModel(model: string) {
    setState((current) => applyVehiclePresetState(current, current.vehicle.brand, model));
    const defaults = resolveVehicleDefaults(state.vehicle.brand, model);
    setOwnerPartDraft((current) => emptyPartDraft(current.installedMileageKm ? Number.parseInt(current.installedMileageKm, 10) : defaults.defaultMileageKm));
    setOwnerPartAssembly('');
    setOwnerPartSubAssembly('');
    setOwnerPartCatalogId(undefined);
  }

  function exportRecords() {
    const payload = JSON.stringify({ vehicle: state.vehicle, journal: state.journal, parts: state.parts, records: state.records }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `codexcar-passport-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setSyncStatus('Экспорт сервисного паспорта подготовлен.');
  }

  function applyTemplateRecord(preset: QuickEntryPreset) {
    const item = getServiceCatalogItem(preset.catalogItemId);
    if (!item) return;
    setQuickEntryDraft((current) => ({
      ...current,
      assembly: item.assembly,
      subAssembly: item.subAssembly,
      partName: item.label,
      catalogItemId: item.id,
    }));
    setActiveQuickHintId(preset.id);
    setIsQuickEntryExpanded(true);
    quickEntryInputRef.current?.focus();
  }

  function selectQuickEntryItem(itemId: string) {
    const item = getServiceCatalogItem(itemId);
    if (!item) return;
    setQuickEntryDraft((current) => ({
      ...current,
      assembly: item.assembly,
      subAssembly: item.subAssembly,
      partName: item.label,
      catalogItemId: item.id,
    }));
    setIsQuickEntryExpanded(true);
    quickEntryInputRef.current?.focus();
  }

  function selectOwnerPartItem(itemId: string) {
    const item = getServiceCatalogItem(itemId);
    if (!item) return;
    setOwnerPartAssembly(item.assembly);
    setOwnerPartSubAssembly(item.subAssembly);
    setOwnerPartCatalogId(item.id);
    setOwnerPartDraft((current) => ({ ...current, name: item.label }));
  }

  function beginEditMaintenance(task: MaintenanceTask) {
    setExpandedMaintenanceId(task.id);
    setEditingMaintenanceId(task.id);
    setMaintenanceEditDraft(emptyMaintenanceEditDraft(task));
  }

  function cancelEditMaintenance() {
    setEditingMaintenanceId(null);
    setMaintenanceEditDraft(emptyMaintenanceEditDraft());
  }

  function saveMaintenanceEdit(taskId: string) {
    const nextMileage = toOptionalNumber(maintenanceEditDraft.lastDoneKm);
    if (nextMileage === undefined) {
      setSyncStatus('Укажите пробег, на котором реально выполнялась работа.');
      return;
    }
    if (nextMileage > state.vehicle.mileageKm) {
      setSyncStatus('Пробег обслуживания не может быть больше текущего пробега автомобиля.');
      return;
    }
    setState((current) => ({
      ...current,
      maintenance: current.maintenance.map((task) => task.id === taskId ? {
        ...task,
        lastDoneKm: nextMileage,
        dueAtKm: nextMileage + task.intervalKm,
        notes: `Последняя ручная отметка: ${nextMileage.toLocaleString('ru-RU')} км. ${task.notes}`,
      } : task),
    }));
    setEditingMaintenanceId(null);
    setMaintenanceEditDraft(emptyMaintenanceEditDraft());
    setSyncStatus('Регламент обновлён вручную.');
  }

  function beginEditJournal(record: JournalRecord) {
    setSwipedRecordId(null);
    setEditingJournalId(record.id);
    setQuickEntryDraft({
      note: record.rawNote ?? record.note,
      occurredAt: new Date(record.createdAt).toISOString().slice(0, 10),
      mileage: record.mileage ? String(record.mileage) : '',
      assembly: record.assembly ?? '',
      subAssembly: record.subAssembly ?? '',
      partName: record.partName ?? '',
      catalogItemId: findServiceCatalogItem(record.partName ?? '', record.assembly, record.subAssembly)?.id ?? undefined,
      cost: record.cost ? String(record.cost) : '',
      nextMileage: record.nextMileage ? String(record.nextMileage) : '',
      rating: record.rating,
    });
    setIsQuickEntryExpanded(true);
    setActiveTab('overview');
    quickEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function removeJournalRecord(recordId: string) {
    setState((current) => ({ ...current, journal: current.journal.filter((record) => record.id !== recordId) }));
    setSwipedRecordId((current) => current === recordId ? null : current);
    if (editingJournalId === recordId) {
      setEditingJournalId(null);
      setQuickEntryDraft(emptyQuickEntryDraft());
    }
    setSyncStatus('Личная запись удалена.');
  }

  async function saveQuickEntry() {
    const selectedItem = findQuickEntryCatalogItem(quickEntryDraft);
    const rawNote = composeQuickEntryNote(quickEntryDraft, selectedItem?.label);
    if (!rawNote) return;
    setIsSavingQuickEntry(true);

    try {
      const mileage = toOptionalNumber(quickEntryDraft.mileage);
      const cost = toOptionalNumber(quickEntryDraft.cost);
      const nextMileage = toOptionalNumber(quickEntryDraft.nextMileage);
      const createdAt = new Date(quickEntryDraft.occurredAt || todayInputValue()).getTime();

      setState((current) => {
        const ensuredCar = buildLocalCar(current);
        const hierarchy = buildQuickEntryPath(quickEntryDraft, selectedItem?.assembly, selectedItem?.subAssembly);
        const record: JournalRecord = {
          id: editingJournalId ?? `record-${Date.now()}`,
          carId: ensuredCar.activeCarId,
          createdAt,
          mileage,
          note: rawNote,
          rawNote: quickEntryDraft.note.trim() || undefined,
          category: 'manual',
          assembly: hierarchy.assembly,
          subAssembly: hierarchy.subAssembly,
          partName: (selectedItem?.label ?? quickEntryDraft.partName.trim()) || undefined,
          cost,
          nextMileage,
          rating: quickEntryDraft.rating,
        };

        const subject = [record.note, record.assembly, record.subAssembly, record.partName].filter(Boolean).join(' ');
        const nextVehicleMileageKm = mileage && mileage > current.vehicle.mileageKm ? mileage : current.vehicle.mileageKm;
        const nextMaintenance = mileage ? updateMaintenanceTasks(current.maintenance, mileage, quickEntryDraft.occurredAt, subject, selectedItem?.maintenanceTaskId) : current.maintenance;
        const nextJournal = editingJournalId ? current.journal.map((item) => item.id === editingJournalId ? record : item) : [record, ...current.journal];

        return {
          ...current,
          ...ensuredCar,
          journal: nextJournal,
          maintenance: nextMaintenance,
          vehicle: { ...current.vehicle, mileageKm: nextVehicleMileageKm },
        };
      });

      setEditingJournalId(null);
      setSwipedRecordId(null);
      setQuickEntryDraft(emptyQuickEntryDraft());
      setIsQuickEntryExpanded(false);
      setActiveQuickHintId(null);
      setSyncStatus('Личная запись сохранена в сервисный паспорт.');
    } catch {
      setSyncStatus('Не удалось сохранить запись. Попробуйте еще раз.');
    } finally {
      setIsSavingQuickEntry(false);
    }
  }

  function handleJournalTouchStart(event: React.TouchEvent<HTMLElement>) {
    setTouchStartX(event.changedTouches[0]?.clientX ?? null);
  }

  function handleJournalTouchEnd(record: JournalRecord, event: React.TouchEvent<HTMLElement>) {
    if (touchStartX === null) return;
    const deltaX = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
    setTouchStartX(null);
    if (deltaX >= 72) {
      beginEditJournal(record);
      return;
    }
    if (deltaX <= -72) {
      setSwipedRecordId((current) => current === record.id ? null : record.id);
    }
  }

  async function addPart(source: 'self' | 'service') {
    const draft = source === 'self' ? ownerPartDraft : servicePartDraft;
    if (!draft.name.trim() || !draft.oem.trim()) {
      setSyncStatus('Для детали нужны хотя бы название и OEM.');
      return;
    }
    if (source === 'service' && state.role !== 'owner' && session && hasCloudProfile && !activeServiceOwnerCode.trim()) {
      setSyncStatus('Сначала выберите owner ID, для которого сохраняется деталь.');
      return;
    }

    const nextPart: Part = {
      id: `part-${Date.now()}`,
      name: draft.name.trim(),
      oem: draft.oem.trim(),
      manufacturer: draft.manufacturer.trim() || 'Не указан',
      price: toOptionalNumber(draft.price) ?? 0,
      status: draft.status,
      note: draft.note.trim(),
      installationSource: source,
      installedAt: draft.installedAt || null,
      installedMileageKm: toOptionalNumber(draft.installedMileageKm) ?? null,
      nextReplacementKm: toOptionalNumber(draft.nextReplacementKm) ?? null,
    };

    try {
      if (session && hasCloudProfile) {
        await upsertVehiclePart({
          ownerCode: state.role === 'owner' ? undefined : activeServiceOwnerCode || undefined,
          name: nextPart.name,
          oem: nextPart.oem,
          manufacturer: nextPart.manufacturer,
          price: nextPart.price,
          status: nextPart.status,
          note: nextPart.note,
          installationSource: nextPart.installationSource,
          installedAt: nextPart.installedAt,
          installedMileageKm: nextPart.installedMileageKm,
          nextReplacementKm: nextPart.nextReplacementKm,
        });
      }

      setState((current) => ({
        ...current,
        parts: [nextPart, ...current.parts],
        maintenance: nextPart.installedMileageKm
          ? updateMaintenanceTasks(current.maintenance, nextPart.installedMileageKm, nextPart.installedAt ?? todayInputValue(), `${nextPart.name} ${nextPart.note}`.trim())
          : current.maintenance,
      }));

      if (source === 'self') {
        setOwnerPartDraft(emptyPartDraft(state.vehicle.mileageKm));
        setOwnerPartAssembly('');
        setOwnerPartSubAssembly('');
        setOwnerPartCatalogId(undefined);
      }
      else setServicePartDraft(emptyPartDraft(state.vehicle.mileageKm));
      setSyncStatus(source === 'self' ? 'Деталь добавлена в личную карточку.' : 'Деталь сохранена от имени СТО.');
    } catch (error) {
      presentCloudError(error, 'Не удалось сохранить деталь.');
    }
  }

  function startEditingPart(part: Part) {
    setEditingPartId(part.id);
    setEditingPartDraft({
      name: part.name,
      oem: part.oem,
      manufacturer: part.manufacturer,
      price: String(part.price || ''),
      note: part.note,
      installedAt: part.installedAt ?? '',
      installedMileageKm: part.installedMileageKm ? String(part.installedMileageKm) : '',
      nextReplacementKm: part.nextReplacementKm ? String(part.nextReplacementKm) : '',
      status: part.status,
    });
  }

  function cancelPartEdit() {
    setEditingPartId(null);
    setEditingPartDraft(emptyPartDraft(state.vehicle.mileageKm));
  }

  async function savePartEdit() {
    if (!editingPartId) return;
    const updatedPart: Part = {
      id: editingPartId,
      name: editingPartDraft.name.trim(),
      oem: editingPartDraft.oem.trim(),
      manufacturer: editingPartDraft.manufacturer.trim() || 'Не указан',
      price: toOptionalNumber(editingPartDraft.price) ?? 0,
      status: editingPartDraft.status,
      note: editingPartDraft.note.trim(),
      installationSource: state.parts.find((part) => part.id === editingPartId)?.installationSource ?? 'self',
      installedAt: editingPartDraft.installedAt || null,
      installedMileageKm: toOptionalNumber(editingPartDraft.installedMileageKm) ?? null,
      nextReplacementKm: toOptionalNumber(editingPartDraft.nextReplacementKm) ?? null,
    };

    try {
      if (session && hasCloudProfile) {
        await upsertVehiclePart({
          ownerCode: state.role === 'owner' ? undefined : activeServiceOwnerCode || undefined,
          partId: updatedPart.id,
          name: updatedPart.name,
          oem: updatedPart.oem,
          manufacturer: updatedPart.manufacturer,
          price: updatedPart.price,
          status: updatedPart.status,
          note: updatedPart.note,
          installationSource: updatedPart.installationSource,
          installedAt: updatedPart.installedAt,
          installedMileageKm: updatedPart.installedMileageKm,
          nextReplacementKm: updatedPart.nextReplacementKm,
        });
      }

      setState((current) => ({ ...current, parts: current.parts.map((part) => part.id === editingPartId ? updatedPart : part) }));
      cancelPartEdit();
      setSyncStatus('Карточка детали обновлена.');
    } catch (error) {
      presentCloudError(error, 'Не удалось обновить деталь.');
    }
  }

  function addClientByOwnerCode() {
    const lookup = clientLookupCode.trim().toUpperCase();
    if (!lookup) return;

    if ((state.role === 'mechanic' || state.role === 'service_admin') && session && hasCloudProfile) {
      void addVehicleToServiceIntake({ ownerCode: lookup, workType: 'Новая запись по owner-коду' }).then(async () => {
        const cloudState = await loadGarageStateFromCloud();
        if (cloudState) setState((current) => mergeLocalOwnerState(current, cloudState));
        setActiveServiceOwnerCode(lookup);
        setClientLookupCode('');
        setSyncStatus('Клиент и очередь сохранены в облаке.');
      }).catch((error) => presentCloudError(error, 'Не удалось добавить клиента в очередь.'));
      return;
    }

    const owner = state.owners.find((item) => item.ownerCode.toUpperCase() === lookup)
      ?? (state.vehicle.ownerCode.toUpperCase() === lookup ? {
        id: 'owner-current',
        name: state.ownerName || 'Владелец',
        ownerCode: state.vehicle.ownerCode,
        primaryVehicle: `${state.vehicle.brand} ${state.vehicle.model}`.trim(),
        companyName: state.serviceCenter.name,
        city: state.serviceCenter.city,
        vehicles: 1,
        lastSeen: 'сейчас',
      } : null);
    if (!owner) {
      setSyncStatus('Автомобиль по этому owner ID не найден.');
      return;
    }

    const clientExists = state.clients.some((item) => item.ownerCode === owner.ownerCode);
    const queueExists = state.serviceQueue.some((item) => item.ownerCode === owner.ownerCode && item.status !== 'ready');
    setState((current) => ({
      ...current,
      clients: clientExists ? current.clients : [{
        id: `client-${Date.now()}`,
        name: owner.name,
        ownerCode: owner.ownerCode,
        phone: '+7 999 000-00-00',
        carLabel: owner.primaryVehicle,
        lastVisit: todayInputValue(),
        serviceCenter: current.serviceCenter.name,
      }, ...current.clients],
      serviceQueue: queueExists ? current.serviceQueue : [{
        id: `queue-${Date.now()}`,
        customer: owner.name,
        ownerCode: owner.ownerCode,
        carLabel: owner.primaryVehicle,
        workType: 'Новая запись по owner-коду',
        scheduledAt: new Date().toLocaleString('ru-RU'),
        status: 'new',
      }, ...current.serviceQueue],
      activityLogs: [{
        id: `log-${Date.now()}`,
        actor: 'Админ СТО',
        action: 'добавил клиента по owner-коду',
        target: `${owner.name} • ${owner.ownerCode}`,
        timestamp: new Date().toLocaleString('ru-RU'),
        scope: 'service',
      }, ...current.activityLogs],
    }));
    setActiveServiceOwnerCode(owner.ownerCode);
    setClientLookupCode('');
    setSyncStatus('Клиент добавлен в очередь.');
  }

  async function saveServiceWork() {
    if (!serviceWorkTitle.trim() || !activeServiceOwnerCode) {
      setSyncStatus('Сначала выберите owner ID и заполните название работы.');
      return;
    }

    if (session && hasCloudProfile) {
      try {
        await addServiceRecordByOwnerCode({ ownerCode: activeServiceOwnerCode, title: serviceWorkTitle, details: serviceWorkDetails, location: state.serviceCenter.name });
        setState((current) => ({
          ...current,
          recentJobs: [{
            id: `job-${Date.now()}`,
            carLabel: current.clients.find((item) => item.ownerCode === activeServiceOwnerCode)?.carLabel ?? activeServiceOwnerCode,
            title: serviceWorkTitle,
            finishedAt: new Date().toLocaleString('ru-RU'),
            verified: true,
          }, ...current.recentJobs],
        }));
        setServiceWorkTitle('');
        setServiceWorkDetails('');
        setSyncStatus('Работа сохранена и подтверждена от имени СТО.');
      } catch (error) {
        presentCloudError(error, 'Не удалось сохранить работу.');
      }
      return;
    }

    setState((current) => ({
      ...current,
      recentJobs: [{
        id: `job-${Date.now()}`,
        carLabel: current.clients.find((item) => item.ownerCode === activeServiceOwnerCode)?.carLabel ?? activeServiceOwnerCode,
        title: serviceWorkTitle,
        finishedAt: new Date().toLocaleString('ru-RU'),
        verified: false,
      }, ...current.recentJobs],
    }));
    setServiceWorkTitle('');
    setServiceWorkDetails('');
    setSyncStatus('Работа сохранена локально.');
  }

  async function setQueueStatus(queueId: string, status: 'new' | 'confirmed' | 'in_service' | 'ready') {
    if (session && hasCloudProfile && (state.role === 'mechanic' || state.role === 'service_admin')) {
      try {
        await updateServiceQueueStatus({ queueId, status });
        const cloudState = await loadGarageStateFromCloud();
        if (cloudState) setState((current) => mergeLocalOwnerState(current, cloudState));
        setSyncStatus('Статус очереди обновлен.');
      } catch (error) {
        presentCloudError(error, 'Не удалось обновить статус очереди.');
      }
      return;
    }

    setState((current) => ({ ...current, serviceQueue: current.serviceQueue.map((item) => item.id === queueId ? { ...item, status } : item) }));
  }

  async function scanOwnerQr() {
    const Detector = (window as Window & {
      BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>> };
    }).BarcodeDetector;

    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setSyncStatus('Сканирование QR не поддерживается на этом устройстве.');
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    await video.play();
    setIsScanningQr(true);
    setSyncStatus('Наведите камеру на QR-код владельца.');

    const detector = new Detector({ formats: ['qr_code'] });
    const stop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setIsScanningQr(false);
    };

    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      const codes = await detector.detect(video);
      const rawValue = codes[0]?.rawValue?.trim();
      if (rawValue) {
        setClientLookupCode(rawValue);
        setSyncStatus(`QR считан: ${rawValue}`);
        stop();
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }

    stop();
    setSyncStatus('QR не распознан. Можно ввести owner ID вручную.');
  }

  function addEmployee() {
    if (!employeeDraft.name.trim()) return;
    const next: StaffMember = {
      id: `staff-${Date.now()}`,
      name: employeeDraft.name,
      role: employeeDraft.role,
      companyName: state.serviceCenter.name,
      approvalStatus: employeeDraft.role === 'mechanic' ? 'pending' : 'approved',
      specialization: employeeDraft.specialization || 'Сотрудник сервиса',
      shift: employeeDraft.shift,
      workplace: employeeDraft.workplace,
      salaryRub: Number.parseInt(employeeDraft.salaryRub, 10) || 0,
      workStatus: employeeDraft.role === 'mechanic' ? 'off_shift' : 'on_shift',
    };
    setState((current) => ({ ...current, staff: [next, ...current.staff] }));
    setEmployeeDraft({ name: '', role: 'mechanic', specialization: '', shift: '', workplace: '', salaryRub: '' });
    setSyncStatus('Сотрудник добавлен в локальный список СТО.');
  }

  async function signIn() {
    if (!isSupabaseEnabled) {
      setSyncStatus('Облако не настроено. Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.');
      return;
    }
    try {
      setSyncStatus('Переходим на вход через Google...');
      await signInWithGoogle();
    } catch (error) {
      presentCloudError(error, 'Ошибка входа.');
    }
  }

  async function logout() {
    try {
      await signOutCloud();
      setSession(null);
      setHasCloudProfile(false);
      setIsSettingsOpen(false);
      setSyncStatus('Вы вышли из облака.');
    } catch (error) {
      presentCloudError(error, 'Ошибка выхода.');
    }
  }

  async function refreshCloud() {
    if (!session) return;
    try {
      const cloudState = await loadGarageStateFromCloud();
      if (cloudState) {
        setState((current) => mergeLocalOwnerState(current, cloudState));
        setHasCloudProfile(true);
      }
      setSyncStatus('Данные синхронизированы.');
    } catch (error) {
      presentCloudError(error, 'Не удалось обновить данные.');
    }
  }

  async function finishOnboarding() {
    if (!session) return;
    try {
      setIsSavingProfile(true);
      if (state.role === 'owner') {
        const nextVin = state.vehicle.vin.trim() || generateStableVin(session.user.id);
        await saveOwnerProfile({
          profileName: profileName.trim(),
          brand: state.vehicle.brand,
          model: state.vehicle.model,
          year: state.vehicle.year,
          vin: nextVin,
          plate: state.vehicle.plate,
          mileageKm: state.vehicle.mileageKm,
          engine: state.vehicle.engine,
          color: state.vehicle.color,
          nextInspection: state.vehicle.nextInspection,
        });
        setState((current) => {
          const ensuredCar = buildLocalCar({
            ...current,
            cars: current.cars.length ? current.cars : [{
              id: `car-${Date.now()}`,
              name: `${current.vehicle.brand} ${current.vehicle.model}`.trim(),
              brand: current.vehicle.brand,
              model: current.vehicle.model,
            }],
          });
          return { ...current, ...ensuredCar, ownerName: profileName.trim(), vehicle: { ...current.vehicle, vin: nextVin } };
        });
      } else if (state.role === 'mechanic') {
        await bootstrapDemoGarage(profileName.trim(), 'mechanic');
        setState((current) => ({ ...current, mechanicName: profileName.trim(), approvalStatus: 'pending' }));
      } else {
        await saveStaffProfile({
          profileName: profileName.trim(),
          role: state.role,
          serviceCenterName,
          serviceCenterCity,
          serviceCenterBays: Number.parseInt(serviceCenterBays, 10) || 1,
        });
      }

      setHasCloudProfile(true);
      const cloudState = await loadGarageStateFromCloud();
      if (cloudState) setState((current) => mergeLocalOwnerState(current, cloudState));
      setSyncStatus('Профиль создан.');
    } catch (error) {
      presentCloudError(error, 'Не удалось завершить регистрацию.');
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function deleteAccount() {
    if (!window.confirm('Удалить данные аккаунта и начать сначала?')) return;
    try {
      if (session) {
        await deleteCloudAccountData();
        await signOutCloud();
      }
      await clearGarageState();
      setState(demoState);
      setSession(null);
      setHasCloudProfile(false);
      setProfileName('');
      setServiceCenterName('');
      setServiceCenterCity('');
      setServiceCenterBays('');
      setOwnerPartDraft(emptyPartDraft());
      setServicePartDraft(emptyPartDraft());
      setQuickEntryDraft(emptyQuickEntryDraft());
      setSyncStatus('Аккаунт очищен. Можно зарегистрироваться заново.');
    } catch (error) {
      presentCloudError(error, 'Не удалось удалить аккаунт.');
    }
  }

  function renderPartCard(part: Part) {
    const isEditing = editingPartId === part.id;
    const remainingKm = part.nextReplacementKm ? Math.max(part.nextReplacementKm - state.vehicle.mileageKm, 0) : null;
    return (
      <article className="part-card" key={part.id}>
        <div className="panel-heading">
          <div>
            <strong>{part.name}</strong>
            <p className="muted">{part.manufacturer}</p>
          </div>
          <div className="part-card-actions">
            <span className={`status-chip ${part.status}`}>{partStatusLabel(part.status)}</span>
            <button className="ghost-button compact" onClick={() => startEditingPart(part)}><Pencil size={14} />Редактировать</button>
          </div>
        </div>
        {isEditing ? (
          <div className="cloud-card">
            <div className="field-row"><input value={editingPartDraft.name} onChange={(event) => setEditingPartDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Название" /></div>
            <div className="field-row"><input value={editingPartDraft.oem} onChange={(event) => setEditingPartDraft((current) => ({ ...current, oem: event.target.value }))} placeholder="OEM" /></div>
            <div className="field-row"><input value={editingPartDraft.manufacturer} onChange={(event) => setEditingPartDraft((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Производитель" /></div>
            <div className="field-row"><input value={editingPartDraft.price} onChange={(event) => setEditingPartDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Цена" /></div>
            <div className="field-row"><input type="date" value={editingPartDraft.installedAt} onChange={(event) => setEditingPartDraft((current) => ({ ...current, installedAt: event.target.value }))} /></div>
            <div className="field-row"><input value={editingPartDraft.installedMileageKm} onChange={(event) => setEditingPartDraft((current) => ({ ...current, installedMileageKm: event.target.value }))} placeholder="Пробег установки" /></div>
            <div className="field-row"><input value={editingPartDraft.nextReplacementKm} onChange={(event) => setEditingPartDraft((current) => ({ ...current, nextReplacementKm: event.target.value }))} placeholder="Следующая замена, км" /></div>
            <div className="field-row"><select value={editingPartDraft.status} onChange={(event) => setEditingPartDraft((current) => ({ ...current, status: event.target.value as Part['status'] }))}><option value="ok">Норма</option><option value="watch">Контроль</option><option value="replace">Замена</option></select></div>
            <div className="field-row"><input value={editingPartDraft.note} onChange={(event) => setEditingPartDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Комментарий" /></div>
            <div className="part-edit-actions">
              <button className="primary-button compact" onClick={savePartEdit}><Save size={14} />Сохранить</button>
              <button className="ghost-button compact" onClick={cancelPartEdit}><X size={14} />Отмена</button>
            </div>
          </div>
        ) : (
          <>
            <div className="part-meta-grid">
              <div><span>OEM</span><strong>{part.oem}</strong></div>
              <div><span>Цена</span><strong>{formatMoney(part.price)}</strong></div>
              <div><span>Установлено</span><strong>{formatLongDate(part.installedAt)}</strong></div>
              <div><span>Пробег установки</span><strong>{part.installedMileageKm ? `${part.installedMileageKm.toLocaleString('ru-RU')} км` : 'Не указан'}</strong></div>
              <div><span>Следующая замена</span><strong>{part.nextReplacementKm ? `${part.nextReplacementKm.toLocaleString('ru-RU')} км` : 'Не указана'}</strong></div>
              <div><span>Остаток</span><strong>{remainingKm !== null ? `${remainingKm.toLocaleString('ru-RU')} км` : '—'}</strong></div>
            </div>
            <div className="part-card-footer">
              <span className={`source-badge ${part.installationSource === 'self' ? 'self' : 'service'}`}><Check size={14} />{partSourceLabel(part.installationSource)}</span>
              {part.note ? <p className="muted">{part.note}</p> : <p className="muted">Комментариев пока нет.</p>}
            </div>
          </>
        )}
      </article>
    );
  }

  function renderJournalCard(record: JournalRecord) {
    const isSwiped = swipedRecordId === record.id;
    return (
      <article
        className={`journal-card ${isSwiped ? 'swiped' : ''}`}
        key={record.id}
        onTouchStart={handleJournalTouchStart}
        onTouchEnd={(event) => handleJournalTouchEnd(record, event)}
      >
        <div className="journal-meta">
          <span className="source-badge neutral">{formatTimelineDate(record.createdAt)}</span>
          {record.mileage ? <span className="source-badge neutral">{record.mileage.toLocaleString('ru-RU')} км</span> : null}
          {record.nextMileage ? <span className="source-badge neutral">Следующая отметка: {record.nextMileage.toLocaleString('ru-RU')} км</span> : null}
          {record.assembly ? <span className="source-badge neutral">{record.assembly}</span> : null}
          {record.subAssembly ? <span className="source-badge neutral">{record.subAssembly}</span> : null}
        </div>
        <strong>{record.note}</strong>
        <div className="journal-details">
          {record.partName ? <span>{record.partName}</span> : null}
          {record.cost ? <span>{formatMoney(record.cost)}</span> : null}
        </div>
        <div className="journal-footer">
          <span className={`source-badge ${record.rating === 'bad' ? 'self' : record.rating === 'good' ? 'service' : 'neutral'}`}>{record.rating === 'bad' ? 'Не подошли' : record.rating === 'good' ? 'Подошли' : 'Без оценки'}</span>
          <div className="journal-actions">
            <button className="ghost-button compact" onClick={() => beginEditJournal(record)}><Pencil size={14} />Редактировать</button>
            <button className="danger-button compact" onClick={() => removeJournalRecord(record.id)}><Trash2 size={14} />Удалить</button>
          </div>
        </div>
        <p className="journal-hint muted">{isSwiped ? 'Карточка раскрыта: удалите запись или смахните вправо, чтобы сразу открыть редактирование.' : 'Свайп вправо открывает редактирование, свайп влево подсвечивает действия.'}</p>
      </article>
    );
  }

  function renderServiceCard(record: ServiceRecord) {
    return (
      <article className="service-history-card" key={record.id}>
        <div className="service-history-head">
          <div>
            <strong>{record.title}</strong>
            <p>{record.date} • {record.location}</p>
          </div>
          <span className={`source-badge ${record.verified ? 'service' : 'neutral'}`}>{record.verified ? 'Подтверждено' : 'Черновик'}</span>
        </div>
        <div className="service-history-meta">
          <span>Мастер: {record.mechanic}</span>
          <span>Авто: {[state.vehicle.brand, state.vehicle.model].filter(Boolean).join(' ') || 'Не заполнено'}</span>
        </div>
        <p className="muted">{record.details || 'Детали работы не указаны.'}</p>
      </article>
    );
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand-lockup">
          <p className="eyebrow">CodexCar</p>
          <strong>{topRoleLabel}</strong>
          <span className="muted">{currentDisplayName}</span>
        </div>
        <div className="auth-strip">
          <span className={`pill ${session ? 'approved' : 'pending'}`}>{session?.user?.email ?? 'Локальный режим'}</span>
          {!session ? <button className="primary-button compact" onClick={signIn}><LogIn size={16} />Войти / регистрация</button> : null}
          <button className="theme-toggle" onClick={() => setIsSettingsOpen((current) => !current)}><Cog size={18} /></button>
          <button className="theme-toggle" onClick={() => setThemeMode((current) => current === 'light' ? 'dark' : 'light')}>{themeMode === 'light' ? <Moon size={18} /> : <SunMedium size={18} />}</button>
        </div>
      </div>

      {isSettingsOpen && (
        <section className="settings-panel">
          <div className="panel-heading">
            <div>
              <h2>Настройки</h2>
              <p className="muted">{session ? 'Тема, внешний вид и скрытый demo-режим для тестов.' : 'Можно пользоваться локально или подключить облако через Google.'}</p>
            </div>
            <Cog size={22} />
          </div>
          <div className="settings-grid">
            <div>
              <span className="settings-label">Аккаунт</span>
              <div className="owner-code-card">
                <strong>{roleLabel}</strong>
                <p className="muted">{currentDisplayName}</p>
              </div>
            </div>
            <div>
              <span className="settings-label">Цвет машины</span>
              <div className="color-picker">
                {availableCarColors.map((color) => (
                  <button key={color} className={state.vehicle.color === color ? 'color-swatch active' : 'color-swatch'} onClick={() => setState((current) => ({ ...current, vehicle: { ...current.vehicle, color } }))}>{color}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="settings-meta">
            <span className="source-badge neutral">Версия приложения: {APP_VERSION}</span>
            <button className="ghost-button compact" onClick={() => setIsDemoModeOpen((current) => !current)}>{isDemoModeOpen ? 'Скрыть demo-режим' : 'Открыть demo-режим'}</button>
          </div>
          {isDemoModeOpen && (
            <div className="cloud-card demo-mode-card">
              <div>
                <strong>Демо режим</strong>
                <p className="muted">Нужен только для тестирования ролей и сценариев. Основной продукт строится вокруг реальной роли аккаунта.</p>
              </div>
              <div className="segmented role-segmented">
                <button className={state.role === 'owner' ? 'active' : ''} onClick={() => switchRole('owner')}>Владелец</button>
                <button className={state.role === 'mechanic' ? 'active' : ''} onClick={() => switchRole('mechanic')}>Механик</button>
                <button className={state.role === 'service_admin' ? 'active' : ''} onClick={() => switchRole('service_admin')}>Админ СТО</button>
                <button className={state.role === 'company_admin' ? 'active' : ''} onClick={() => switchRole('company_admin')}>Модератор</button>
              </div>
            </div>
          )}
          <div className="settings-footer">
            {session ? <button className="ghost-button" onClick={refreshCloud}><Download size={16} />Обновить из облака</button> : null}
            {session ? <button className="danger-button" onClick={logout}><LogIn size={16} />Выйти</button> : null}
            {session ? <button className="danger-button" onClick={deleteAccount}><Trash2 size={16} />Удалить аккаунт и данные</button> : null}
          </div>
        </section>
      )}

      {!session ? null : showOnboarding ? (
        <section className="onboarding-screen">
          <section className="settings-panel onboarding-panel">
            <div className="panel-heading">
              <div>
                <h2>Завершите регистрацию</h2>
                <p className="muted">Сначала сохраним базовый профиль. Пока он не заполнен, рабочие разделы скрыты.</p>
              </div>
              <BadgeCheck size={22} />
            </div>
            <div className="cloud-card">
              <div>
                <span className="settings-label">Выберите роль</span>
                <div className="segmented role-segmented">
                  <button className={state.role === 'owner' ? 'active' : ''} onClick={() => switchRole('owner')}>Владелец</button>
                  <button className={state.role === 'mechanic' ? 'active' : ''} onClick={() => switchRole('mechanic')}>Механик</button>
                  <button className={state.role === 'service_admin' ? 'active' : ''} onClick={() => switchRole('service_admin')}>Админ СТО</button>
                  <button className={state.role === 'company_admin' ? 'active' : ''} onClick={() => switchRole('company_admin')}>Модератор</button>
                </div>
              </div>
              <div className="field-row"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Ваше имя и фамилия" /></div>
              {state.role === 'owner' ? (
                <>
                  <div className="field-row"><select value={state.vehicle.brand} onChange={(event) => updateVehicleBrand(event.target.value)}><option value="">Выберите марку</option>{vehicleBrandOptions.map((option) => <option key={option.brand} value={option.brand}>{option.brand}</option>)}</select></div>
                  <div className="field-row"><select value={state.vehicle.model} onChange={(event) => updateVehicleModel(event.target.value)} disabled={!state.vehicle.brand}><option value="">{state.vehicle.brand ? 'Выберите модель' : 'Сначала выберите марку'}</option>{selectedBrandOption.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></div>
                  <div className="field-row"><input value={state.vehicle.plate} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, plate: event.target.value } }))} placeholder="Номер авто" /></div>
                  <div className="field-row"><input value={state.vehicle.vin} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, vin: event.target.value.toUpperCase() } }))} placeholder="VIN" /></div>
                </>
              ) : (state.role === 'service_admin' || state.role === 'company_admin') ? (
                <>
                  <div className="field-row"><input value={serviceCenterName} onChange={(event) => setServiceCenterName(event.target.value)} placeholder="Название СТО" /></div>
                  <div className="field-row"><input value={serviceCenterCity} onChange={(event) => setServiceCenterCity(event.target.value)} placeholder="Город" /></div>
                  <div className="field-row"><input value={serviceCenterBays} onChange={(event) => setServiceCenterBays(event.target.value)} placeholder="Количество постов" /></div>
                </>
              ) : null}
              <div className="hero-actions">
                <button className="primary-button" onClick={finishOnboarding} disabled={isSavingProfile || !profileName.trim() || (state.role === 'owner' && (!state.vehicle.brand || !state.vehicle.model)) || ((state.role === 'service_admin' || state.role === 'company_admin') && !serviceCenterName.trim())}>{isSavingProfile ? 'Сохраняем...' : 'Сохранить профиль'}</button>
              </div>
              <p className="muted onboarding-status">{syncStatus}</p>
            </div>
          </section>
        </section>
      ) : (
        <>
          {activeTab === 'overview' && (
            <header className="hero-card">
              <div className="hero-copy">
                <p className="eyebrow">Цифровой сервисный паспорт</p>
                <h1>{state.role === 'owner' ? 'История машины, детали и сервис без хаоса' : state.role === 'mechanic' ? 'Смена, очередь и подтвержденные работы в одном окне' : state.role === 'service_admin' ? 'СТО и команда под рукой' : 'Платформа компаний и сервисов'}</h1>
                <p className="hero-text">{syncStatus}</p>
                <div className="hero-kpis">
                  {state.role === 'owner' ? (
                    <>
                      <div><span>Пробег</span><strong>{state.vehicle.mileageKm.toLocaleString('ru-RU')} км</strong></div>
                      <div><span>Подтверждено СТО</span><strong>{verifiedRecords.length}</strong></div>
                      <div><span>Карточек деталей</span><strong>{state.parts.length}</strong></div>
                    </>
                  ) : (
                    <>
                      <div><span>Очередь</span><strong>{state.serviceQueue.filter((item) => item.status !== 'ready').length}</strong></div>
                      <div><span>Клиенты</span><strong>{state.clients.length}</strong></div>
                      <div><span>Записей</span><strong>{state.recentJobs.length}</strong></div>
                    </>
                  )}
                </div>
                <div className="hero-actions">
                  {state.role === 'owner' ? (
                    <>
                      <button className="primary-button" onClick={() => quickEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Plus size={16} />Добавить запись</button>
                      <button className="ghost-button" onClick={() => { setIsPassportExpanded(true); passportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><CarFront size={16} />Открыть паспорт</button>
                      <button className="ghost-button" onClick={() => setActiveTab('maintenance')}><ShieldCheck size={16} />Ближайшие замены</button>
                    </>
                  ) : (
                    <>
                      <button className="primary-button" onClick={refreshCloud} disabled={!session}><Download size={16} />Обновить</button>
                      {(state.role === 'mechanic' || state.role === 'service_admin') ? <button className="ghost-button" onClick={() => setActiveTab('maintenance')}><Users size={16} />Открыть клиентов</button> : null}
                    </>
                  )}
                </div>
              </div>
              <div className="hero-panel">
                {state.role === 'owner' ? (
                  <section className="vehicle-card hero-passport" ref={passportRef}>
                    <button className="passport-toggle" onClick={() => setIsPassportExpanded((current) => !current)}>
                      <div className="passport-collapsed">
                        <div className="passport-visual" style={{ backgroundColor: carVisual.accent }}><img src={carVisual.image} alt={`${state.vehicle.brand || 'Авто'} showcase`} /></div>
                        <div><strong>{`${state.vehicle.brand} ${state.vehicle.model}`.trim() || 'Ваш автомобиль'}</strong><p>{state.vehicle.plate || 'Номер появится после заполнения профиля'}</p></div>
                      </div>
                      {isPassportExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                    {isPassportExpanded ? <div className="passport-expanded"><div className="vehicle-grid passport-details"><div><span>ID владельца</span><strong>{state.vehicle.ownerCode || 'Появится после регистрации'}</strong></div><div><span>VIN</span><strong>{state.vehicle.vin || 'Не указан'}</strong></div><div><span>Пробег</span><strong>{state.vehicle.mileageKm ? `${state.vehicle.mileageKm.toLocaleString('ru-RU')} км` : 'Не указан'}</strong></div><div><span>Двигатель</span><strong>{state.vehicle.engine || 'Не указан'}</strong></div><div><span>Цвет</span><strong>{state.vehicle.color}</strong></div><div><span>Осмотр</span><strong>{state.vehicle.nextInspection || 'Не указан'}</strong></div></div><div className="passport-share"><div className="owner-code-card"><strong>{state.vehicle.ownerCode || 'ID появится после регистрации'}</strong><p className="muted">Этот owner ID можно ввести вручную на СТО или передать по QR.</p></div>{ownerQrCode ? <div className="qr-card"><img src={ownerQrCode} alt="QR владельца" /><p className="muted">QR с owner ID</p></div> : null}</div><div className="panel-heading passport-edit-heading"><div><h2>Сведения об авто</h2><p className="muted">Редактирование собрано прямо внутри карточки машины.</p></div><div className="owner-overview-actions"><button className="ghost-button compact" onClick={prepareNewVehicle}><CarFront size={14} />Новая машина</button><button className="ghost-button compact" onClick={() => setIsVehicleEditorOpen((current) => !current)}><Pencil size={14} />{isVehicleEditorOpen ? 'Свернуть' : 'Изменить'}</button></div></div>{isVehicleEditorOpen ? <div className="cloud-card"><div className="field-row"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Ваше имя и фамилия" /></div><div className="field-row"><select value={state.vehicle.brand} onChange={(event) => updateVehicleBrand(event.target.value)}><option value="">Выберите марку</option>{vehicleBrandOptions.map((option) => <option key={option.brand} value={option.brand}>{option.brand}</option>)}</select></div><div className="field-row"><select value={state.vehicle.model} onChange={(event) => updateVehicleModel(event.target.value)} disabled={!state.vehicle.brand}><option value="">{state.vehicle.brand ? 'Выберите модель' : 'Сначала выберите марку'}</option>{selectedBrandOption.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></div><div className="field-row"><input value={state.vehicle.plate} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, plate: event.target.value } }))} placeholder="Номер" /></div><div className="field-row"><input value={state.vehicle.vin} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, vin: event.target.value.toUpperCase() } }))} placeholder="VIN" /></div><div className="field-row"><input value={state.vehicle.mileageKm ? String(state.vehicle.mileageKm) : ''} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, mileageKm: Number.parseInt(event.target.value, 10) || 0 } }))} placeholder="Пробег" /></div><div className="field-row"><input value={state.vehicle.engine} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, engine: event.target.value } }))} placeholder="Двигатель" /></div><div className="field-row"><input value={state.vehicle.nextInspection} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, nextInspection: event.target.value } }))} placeholder="Следующий осмотр" /></div><button className="primary-button" onClick={() => { setState((current) => ({ ...current, ownerName: profileName.trim() })); setIsVehicleEditorOpen(false); setSyncStatus('Паспорт автомобиля обновлен локально.'); }}>Сохранить сведения</button></div> : null}</div> : null}
                  </section>
                ) : (
                  <div className="vehicle-card"><div className="vehicle-title">{state.role === 'mechanic' ? <Wrench size={20} /> : <Users size={20} />}<strong>{state.serviceCenter.name || 'СТО появится после регистрации'}</strong></div><p>{state.serviceCenter.city || 'Сначала завершите профиль'}</p><div className="vehicle-grid"><div><span>Постов</span><strong>{state.serviceCenter.bays || '—'}</strong></div><div><span>В работе</span><strong>{state.serviceQueue.filter((item) => item.status === 'in_service').length}</strong></div><div><span>Клиентов</span><strong>{state.clients.length}</strong></div><div><span>Ожидают механика</span><strong>{state.staff.filter((item) => item.role === 'mechanic' && item.approvalStatus === 'pending').length}</strong></div></div></div>
                )}
              </div>
            </header>
          )}

          <nav className="tabs tabs-top" style={{ '--tab-count': String(tabs.length) } as CSSProperties}>
            {tabs.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tabLabels[tab]}</button>)}
          </nav>

          <main className={state.role === 'owner' && activeTab === 'overview' ? 'dashboard dashboard-with-fab' : 'dashboard'}>
            {state.role === 'owner' && activeTab !== 'overview' && ownerSectionMeta[activeTab] ? <section className="owner-context-card"><p className="eyebrow">CodexCar</p><h2>{ownerSectionMeta[activeTab]?.title}</h2><p className="muted">{ownerSectionMeta[activeTab]?.text}</p></section> : null}

            {state.role === 'owner' && activeTab === 'overview' ? (
              <section className="grid">
                <article className="panel">
                  <div className="panel-heading"><div><h2>Критичные интервалы</h2><p className="muted">Самые важные узлы, которые лучше держать на виду каждый день.</p></div><Gauge size={22} /></div>
                  <div className="maintenance-summary-grid">
                    <div className="feature highlight-card oil"><div><strong>{oilTask?.title ?? 'Масло двигателя'}</strong><p className="muted">Ближайшая обязательная замена</p></div><strong>{oilTask ? `${remainingMileage(oilTask, state.vehicle.mileageKm).toLocaleString('ru-RU')} км` : '—'}</strong></div>
                    <div className="feature highlight-card timing"><div><strong>{timingTask?.title ?? 'ГРМ / цепь'}</strong><p className="muted">Критичный узел двигателя</p></div><strong>{timingTask ? `${remainingMileage(timingTask, state.vehicle.mileageKm).toLocaleString('ru-RU')} км` : '—'}</strong></div>
                    <div className="feature highlight-card brakes"><div><strong>{brakeTask?.title ?? 'Тормоза'}</strong><p className="muted">Колодки и диски</p></div><strong>{brakeTask ? `${remainingMileage(brakeTask, state.vehicle.mileageKm).toLocaleString('ru-RU')} км` : '—'}</strong></div>
                    <div className="feature highlight-card service"><div><strong>{nearestMaintenance?.title ?? 'Регламент не найден'}</strong><p className="muted">Ближайший обязательный сервис</p></div><strong>{nearestMaintenance ? `${remainingMileage(nearestMaintenance, state.vehicle.mileageKm).toLocaleString('ru-RU')} км` : '—'}</strong></div>
                  </div>
                  {urgentParts.length ? <div className="owner-callout"><TriangleAlert size={18} /><div><strong>Скоро подойдут к замене</strong><p className="muted">{urgentParts.slice(0, 2).map((part) => part.name).join(', ')}.</p></div></div> : null}
                </article>
                <article className="panel panel-wide" ref={quickEntryRef}>
                  <div className="panel-heading owner-entry-heading">
                    <div>
                      <h2>{editingJournalId ? 'Редактировать личную запись' : 'Ручная запись обслуживания'}</h2>
                      <p className="muted">Здесь только расходники и сервисные жидкости: масло, фильтры, антифриз, масло коробки и другие регулярные замены.</p>
                    </div>
                    <div className="owner-entry-actions">
                      {quickEntryPresets.map((preset) => (
                        <button
                          key={preset.id}
                          className={`ghost-button compact ${activeQuickPreset?.id === preset.id ? 'active-quick-preset' : ''}`}
                          onClick={() => applyTemplateRecord(preset)}
                          onMouseEnter={() => setActiveQuickHintId(preset.id)}
                          onFocus={() => setActiveQuickHintId(preset.id)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="quick-entry-shell">
                    {activeQuickPreset && activeQuickPresetItem ? (
                      <div className="quick-preset-hint" role="status">
                        <strong>{activeQuickPreset.label}</strong>
                        <p>{activeQuickPresetItem.assembly} → {activeQuickPresetItem.subAssembly}. {activeQuickPreset.hint}</p>
                      </div>
                    ) : null}
                    <div className="quick-entry-catalog-grid">
                      <div className="field-row">
                        <select
                          value={quickEntryDraft.assembly}
                          onChange={(event) => setQuickEntryDraft((current) => ({
                            ...current,
                            assembly: event.target.value,
                            subAssembly: '',
                            partName: '',
                            catalogItemId: undefined,
                          }))}
                        >
                          <option value="">Выберите узел</option>
                          {assemblyOptions.map((assembly) => <option key={assembly} value={assembly}>{assembly}</option>)}
                        </select>
                      </div>
                      <div className="field-row">
                        <select
                          value={quickEntryDraft.subAssembly}
                          onChange={(event) => setQuickEntryDraft((current) => ({
                            ...current,
                            subAssembly: event.target.value,
                            partName: '',
                            catalogItemId: undefined,
                          }))}
                          disabled={!quickEntryDraft.assembly}
                        >
                          <option value="">{quickEntryDraft.assembly ? 'Выберите подузел' : 'Сначала выберите узел'}</option>
                          {subAssemblyOptions.map((subAssembly) => <option key={subAssembly} value={subAssembly}>{subAssembly}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="quick-entry-search">
                      <div className="field-row quick-entry-primary">
                        <input
                          value={quickEntryDraft.partName}
                          onChange={(event) => setQuickEntryDraft((current) => ({
                            ...current,
                            partName: event.target.value,
                            catalogItemId: undefined,
                          }))}
                          placeholder="Начните вводить: масло, фильтр, антифриз, тормозная жидкость..."
                        />
                      </div>
                      {(quickEntryDraft.partName.trim().length >= 1 || (quickEntryDraft.assembly && quickEntryDraft.subAssembly)) && quickEntrySuggestions.length ? (
                        <div className="quick-entry-suggestions">
                          {quickEntrySuggestions.map((item) => (
                            <button key={item.id} className="quick-entry-suggestion" onClick={() => selectQuickEntryItem(item.id)}>
                              <strong>{item.label}</strong>
                              <span>{item.assembly} • {item.subAssembly}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {selectedQuickEntryItem ? <p className="quick-entry-selected muted">Выбрано: {selectedQuickEntryItem.assembly} → {selectedQuickEntryItem.subAssembly} → {selectedQuickEntryItem.label}</p> : null}
                    <div className="field-row quick-entry-primary">
                      <input
                        ref={quickEntryInputRef}
                        value={quickEntryDraft.note}
                        onChange={(event) => setQuickEntryDraft((current) => ({ ...current, note: event.target.value }))}
                        placeholder="Комментарий: что сделали, что не подошло, что заметили"
                      />
                      <button className="primary-button big-add-button" onClick={saveQuickEntry} disabled={isSavingQuickEntry || (!quickEntryDraft.note.trim() && !quickEntryDraft.partName.trim())}><Plus size={18} />{editingJournalId ? 'Сохранить' : 'Добавить'}</button>
                    </div>
                    <button className="ghost-button compact inline-toggle" onClick={() => setIsQuickEntryExpanded((current) => !current)}>{isQuickEntryExpanded ? 'Скрыть доп. поля' : 'Показать доп. поля'}</button>
                    {isQuickEntryExpanded ? (
                      <div className="quick-entry-optional">
                        <div className="field-row">
                          <input type="date" value={quickEntryDraft.occurredAt} onChange={(event) => setQuickEntryDraft((current) => ({ ...current, occurredAt: event.target.value }))} />
                        </div>
                        <div className="field-row">
                          <input value={quickEntryDraft.mileage} onChange={(event) => setQuickEntryDraft((current) => ({ ...current, mileage: event.target.value }))} placeholder="Пробег, км" />
                        </div>
                        <div className="field-row">
                          <input value={quickEntryDraft.cost} onChange={(event) => setQuickEntryDraft((current) => ({ ...current, cost: event.target.value }))} placeholder="Стоимость" />
                        </div>
                        <div className="field-row">
                          <input value={quickEntryDraft.nextMileage} onChange={(event) => setQuickEntryDraft((current) => ({ ...current, nextMileage: event.target.value }))} placeholder="Следующая замена, км" />
                        </div>
                        <div className="segmented rating-segmented">
                          <button className={quickEntryDraft.rating === 'good' ? 'active' : ''} onClick={() => setQuickEntryDraft((current) => ({ ...current, rating: current.rating === 'good' ? undefined : 'good' }))}>Подошли</button>
                          <button className={quickEntryDraft.rating === 'bad' ? 'active' : ''} onClick={() => setQuickEntryDraft((current) => ({ ...current, rating: current.rating === 'bad' ? undefined : 'bad' }))}>Не подошли</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </article>
                <article className="panel"><div className="panel-heading"><div><h2>Последние записи владельца</h2><p className="muted">То, что вы делали сами или хотите сохранить как заметку по эксплуатации.</p></div><CalendarDays size={22} /></div><div className="timeline journal-timeline">{ownerTimeline.length ? ownerTimeline.slice(0, 4).map(renderJournalCard) : <EmptyState title="Личных записей пока нет" text="Сохраните первую замену масла, фильтров или тормозов в верхнем блоке." />}</div></article>
                <article className="panel"><div className="panel-heading"><div><h2>Подтверждено СТО</h2><p className="muted">Отдельный блок для работ, которые были сохранены механиком или сервисом.</p></div><BadgeCheck size={22} /></div><div className="service-summary-grid"><div className="feature"><div><strong>{verifiedRecords.length}</strong><p className="muted">Подтвержденных работ</p></div></div><div className="feature"><div><strong>{latestVerifiedRecord?.date ?? '—'}</strong><p className="muted">Последний визит</p></div></div><div className="feature"><div><strong>{latestVerifiedRecord?.location ?? 'СТО не указано'}</strong><p className="muted">Где обслуживали</p></div></div></div><div className="service-history-stack compact-stack">{verifiedRecords.length ? verifiedRecords.slice(0, 3).map(renderServiceCard) : <EmptyState title="Подтвержденных визитов пока нет" text="Когда механик добавит запись по owner ID, она появится здесь." />}</div></article>
              </section>
            ) : null}

            {state.role === 'owner' && activeTab === 'parts' ? (
              <section className="grid">
                <article className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Добавить деталь</h2>
                      <p className="muted">Подберите узел и деталь через каталог, затем сохраните OEM, установку и комментарии по ресурсу.</p>
                    </div>
                    <Plus size={20} />
                  </div>
                  <div className="cloud-card">
                    <div className="quick-entry-catalog-grid">
                      <div className="field-row">
                        <select
                          value={ownerPartAssembly}
                          onChange={(event) => {
                            setOwnerPartAssembly(event.target.value);
                            setOwnerPartSubAssembly('');
                            setOwnerPartCatalogId(undefined);
                            setOwnerPartDraft((current) => ({ ...current, name: '' }));
                          }}
                        >
                          <option value="">Выберите узел</option>
                          {getServiceAssemblies().map((assembly) => <option key={assembly} value={assembly}>{assembly}</option>)}
                        </select>
                      </div>
                      <div className="field-row">
                        <select
                          value={ownerPartSubAssembly}
                          onChange={(event) => {
                            setOwnerPartSubAssembly(event.target.value);
                            setOwnerPartCatalogId(undefined);
                            setOwnerPartDraft((current) => ({ ...current, name: '' }));
                          }}
                          disabled={!ownerPartAssembly}
                        >
                          <option value="">{ownerPartAssembly ? 'Выберите подузел' : 'Сначала выберите узел'}</option>
                          {ownerPartSubAssemblyOptions.map((subAssembly) => <option key={subAssembly} value={subAssembly}>{subAssembly}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="quick-entry-search">
                      <div className="field-row">
                        <input
                          value={ownerPartDraft.name}
                          onChange={(event) => {
                            setOwnerPartCatalogId(undefined);
                            setOwnerPartDraft((current) => ({ ...current, name: event.target.value }));
                          }}
                          placeholder="Начните вводить: сцепление, шрус, амортизатор, рычаг..."
                        />
                      </div>
                      {(ownerPartDraft.name.trim().length >= 1 || (ownerPartAssembly && ownerPartSubAssembly)) && ownerPartSuggestions.length ? (
                        <div className="quick-entry-suggestions">
                          {ownerPartSuggestions.map((item) => (
                            <button key={item.id} className="quick-entry-suggestion" onClick={() => selectOwnerPartItem(item.id)}>
                              <strong>{item.label}</strong>
                              <span>{item.assembly} • {item.subAssembly}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {selectedOwnerPartItem ? <p className="quick-entry-selected muted">Выбрано: {selectedOwnerPartItem.assembly} → {selectedOwnerPartItem.subAssembly} → {selectedOwnerPartItem.label}</p> : null}
                    <div className="field-row"><input value={ownerPartDraft.oem} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, oem: event.target.value }))} placeholder="OEM" /></div>
                    <div className="field-row"><input value={ownerPartDraft.manufacturer} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Производитель" /></div>
                    <div className="field-row"><input value={ownerPartDraft.price} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Цена" /></div>
                    <div className="field-row"><input type="date" value={ownerPartDraft.installedAt} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, installedAt: event.target.value }))} /></div>
                    <div className="field-row"><input value={ownerPartDraft.installedMileageKm} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, installedMileageKm: event.target.value }))} placeholder="Пробег установки" /></div>
                    <div className="field-row"><input value={ownerPartDraft.nextReplacementKm} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, nextReplacementKm: event.target.value }))} placeholder="Следующая замена, км" /></div>
                    <div className="field-row"><select value={ownerPartDraft.status} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, status: event.target.value as Part['status'] }))}><option value="ok">Норма</option><option value="watch">Контроль</option><option value="replace">Замена</option></select></div>
                    <div className="field-row"><input value={ownerPartDraft.note} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Комментарий: подошли / быстро стерлись / что важно учесть" /></div>
                    <button className="primary-button" onClick={() => addPart('self')}>Добавить деталь</button>
                  </div>
                </article>
                <article className="panel panel-wide">
                  <div className="parts-grid">{state.parts.length ? state.parts.map(renderPartCard) : <EmptyState title="Карточек деталей пока нет" text="Добавьте первую деталь, чтобы сохранить OEM, дату установки и пробег замены." />}</div>
                </article>
              </section>
            ) : null}

            {state.role === 'owner' && activeTab === 'maintenance' ? (
              <section className="grid">
                <article className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Ближайший регламент</h2>
                      <p className="muted">С понятными цветами, запасом по пробегу и ручной корректировкой последней замены.</p>
                    </div>
                    <ShieldCheck size={22} />
                  </div>
                  <div className="maintenance-summary-grid">
                    <div className={`feature maintenance-summary-card ${nearestMaintenance ? maintenanceUrgency(nearestMaintenance, state.vehicle.mileageKm) : 'ok'}`}>
                      <span className="maintenance-summary-label">Следующий шаг</span>
                      <strong>{nearestMaintenance?.title ?? 'Регламент не найден'}</strong>
                      <p className="muted">{nearestMaintenance ? maintenanceUrgencyLabel(nearestMaintenance, state.vehicle.mileageKm) : 'Добавьте автомобиль'}</p>
                      <strong>{nearestMaintenance ? `${remainingMileage(nearestMaintenance, state.vehicle.mileageKm).toLocaleString('ru-RU')} км` : '—'}</strong>
                    </div>
                    <div className="feature maintenance-summary-card neutral">
                      <span className="maintenance-summary-label">Автомобиль</span>
                      <strong>{state.vehicle.mileageKm.toLocaleString('ru-RU')} км</strong>
                      <p className="muted">Текущий пробег</p>
                      <strong>{state.vehicle.nextInspection || 'Осмотр не указан'}</strong>
                    </div>
                    <div className="feature maintenance-summary-card neutral">
                      <span className="maintenance-summary-label">Под контролем</span>
                      <strong>{state.maintenance.length}</strong>
                      <p className="muted">Этапов регламента</p>
                      <strong>{state.parts.length} деталей</strong>
                    </div>
                  </div>
                </article>
                <article className="panel panel-wide maintenance-stack">
                  {state.maintenance.length ? [...state.maintenance]
                    .sort((left, right) => remainingMileage(left, state.vehicle.mileageKm) - remainingMileage(right, state.vehicle.mileageKm))
                    .map((task) => {
                      const urgency = maintenanceUrgency(task, state.vehicle.mileageKm);
                      const isExpanded = expandedMaintenanceId === task.id;
                      const isEditing = editingMaintenanceId === task.id;
                      return (
                        <article className={`maintenance-card ${urgency}`} key={task.id}>
                          <button className="maintenance-toggle" onClick={() => setExpandedMaintenanceId((current) => current === task.id ? null : task.id)}>
                            <div className="maintenance-heading-block">
                              <div className="maintenance-title-row">
                                <strong>{task.title}</strong>
                                <span className={`source-badge ${urgency === 'danger' ? 'self' : urgency === 'warning' ? 'warning' : 'service'}`}>{maintenanceUrgencyLabel(task, state.vehicle.mileageKm)}</span>
                              </div>
                              <p className="muted">Следующая отметка до {task.dueAtKm.toLocaleString('ru-RU')} км</p>
                            </div>
                            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </button>
                          <div className="maintenance-meta-grid">
                            <div><span>Осталось</span><strong>{remainingMileage(task, state.vehicle.mileageKm).toLocaleString('ru-RU')} км</strong></div>
                            <div><span>Последний раз</span><strong>{task.lastDoneKm.toLocaleString('ru-RU')} км</strong></div>
                            <div><span>Интервал</span><strong>{task.intervalKm.toLocaleString('ru-RU')} км</strong></div>
                          </div>
                          <div className="progress-track maintenance-progress-track">
                            <div className={`progress-bar ${urgency}`} style={{ width: `${maintenanceProgress(task, state.vehicle.mileageKm)}%` }} />
                          </div>
                          {isExpanded ? (
                            <div className="maintenance-details">
                              <div className="maintenance-actions-row">
                                <button className="ghost-button compact" onClick={() => beginEditMaintenance(task)}><Pencil size={14} />Отметить замену</button>
                              </div>
                              {isEditing ? (
                                <div className="maintenance-edit-card">
                                  <div className="field-row">
                                    <input value={maintenanceEditDraft.lastDoneKm} onChange={(event) => setMaintenanceEditDraft({ lastDoneKm: event.target.value })} placeholder={`Не больше ${state.vehicle.mileageKm.toLocaleString('ru-RU')} км`} />
                                  </div>
                                  <div className="maintenance-edit-actions">
                                    <button className="primary-button compact" onClick={() => saveMaintenanceEdit(task.id)}><Save size={14} />Сохранить</button>
                                    <button className="ghost-button compact" onClick={cancelEditMaintenance}><X size={14} />Отмена</button>
                                  </div>
                                  <p className="muted">Укажите реальный пробег последней замены. Он не может быть больше текущего пробега авто.</p>
                                </div>
                              ) : null}
                              <ul className="stack-list">{task.items.map((item) => <li key={item}>{item}</li>)}</ul>
                              <p className="muted">{task.notes}</p>
                            </div>
                          ) : null}
                        </article>
                      );
                    }) : <EmptyState title="Регламент пока не заполнен" text="После первой машины здесь появится карта обслуживания по пробегу." />}
                </article>
              </section>
            ) : null}

            {state.role === 'owner' && activeTab === 'history' ? <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Сервисная сводка</h2><p className="muted">Только визиты в сервис и подтвержденные работы без личных заметок.</p></div><Wrench size={22} /></div><div className="service-summary-grid"><div className="feature"><div><strong>{verifiedRecords.length}</strong><p className="muted">Подтвержденных работ</p></div></div><div className="feature"><div><strong>{latestVerifiedRecord?.date ?? '—'}</strong><p className="muted">Последний визит</p></div></div><div className="feature"><div><strong>{latestVerifiedRecord?.location ?? 'СТО не указано'}</strong><p className="muted">Последнее место обслуживания</p></div></div></div><div className="owner-overview-actions"><button className="primary-button compact" onClick={exportRecords}><Download size={14} />Экспортировать паспорт</button></div></article><article className="panel panel-wide"><div className="panel-heading"><div><h2>История работ СТО</h2><p className="muted">Каждая запись показывает дату, сервис, исполнителя и итог работ.</p></div><BadgeCheck size={22} /></div><div className="service-history-stack">{state.records.length ? state.records.map(renderServiceCard) : <EmptyState title="История обслуживания пуста" text="Когда вы или сервис добавите первую работу, она появится здесь." />}</div></article></section> : null}

            {state.role === 'mechanic' && activeTab === 'overview' ? <section className="grid"><article className="panel panel-wide"><div className="panel-heading"><div><h2>Смена и задачи</h2><p className="muted">Живая очередь по owner ID и готовые быстрые действия по текущей смене.</p></div><Wrench size={22} /></div><div className="timeline">{state.mechanicTasks.length ? state.mechanicTasks.map((task) => <div className="timeline-item" key={task.id}><div><strong>{task.title}</strong><p>{task.carLabel} • {task.ownerName}</p><p className="muted">{task.bay} • {task.scheduledAt}</p></div><button className="ghost-button compact" onClick={() => setState((current) => ({ ...current, mechanicTasks: current.mechanicTasks.map((item) => item.id === task.id ? { ...item, status: 'done' } : item) }))}>Готово</button></div>) : <EmptyState title="Сегодня задач пока нет" text="Новые работы появятся здесь, как только администратор или вы добавите машину в очередь." />}</div></article></section> : null}

            {state.role === 'mechanic' && activeTab === 'parts' ? <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Добавить деталь от СТО</h2><p className="muted">Карточка сразу помечается как подтвержденная сервисом.</p></div><Plus size={20} /></div><div className="cloud-card"><div className="field-row"><input value={servicePartDraft.name} onChange={(event) => setServicePartDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Название" /></div><div className="field-row"><input value={servicePartDraft.oem} onChange={(event) => setServicePartDraft((current) => ({ ...current, oem: event.target.value }))} placeholder="OEM" /></div><div className="field-row"><input value={servicePartDraft.manufacturer} onChange={(event) => setServicePartDraft((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Производитель" /></div><div className="field-row"><input value={servicePartDraft.price} onChange={(event) => setServicePartDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Цена" /></div><div className="field-row"><input type="date" value={servicePartDraft.installedAt} onChange={(event) => setServicePartDraft((current) => ({ ...current, installedAt: event.target.value }))} /></div><div className="field-row"><input value={servicePartDraft.installedMileageKm} onChange={(event) => setServicePartDraft((current) => ({ ...current, installedMileageKm: event.target.value }))} placeholder="Пробег установки" /></div><div className="field-row"><input value={servicePartDraft.nextReplacementKm} onChange={(event) => setServicePartDraft((current) => ({ ...current, nextReplacementKm: event.target.value }))} placeholder="Следующая замена, км" /></div><div className="field-row"><select value={servicePartDraft.status} onChange={(event) => setServicePartDraft((current) => ({ ...current, status: event.target.value as Part['status'] }))}><option value="ok">Норма</option><option value="watch">Контроль</option><option value="replace">Замена</option></select></div><div className="field-row"><input value={servicePartDraft.note} onChange={(event) => setServicePartDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Комментарий механика" /></div><button className="primary-button" onClick={() => addPart('service')}>Добавить деталь</button></div></article><article className="panel panel-wide"><div className="parts-grid">{state.parts.length ? state.parts.map(renderPartCard) : <EmptyState title="Деталей пока нет" text="Выберите авто владельца и добавьте первую установленную деталь." />}</div></article></section> : null}

            {state.role === 'mechanic' && activeTab === 'maintenance' ? <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Добавить по owner ID</h2><p className="muted">Можно ввести ID вручную или считать QR с карточки владельца.</p></div><ScanLine size={22} /></div><div className="cloud-card"><div className="field-row"><input value={clientLookupCode} onChange={(event) => setClientLookupCode(event.target.value)} placeholder="UUID владельца" /></div><div className="hero-actions"><button className="ghost-button" onClick={scanOwnerQr} disabled={isScanningQr}>{isScanningQr ? 'Сканируем...' : 'Считать QR'}</button><button className="primary-button" onClick={addClientByOwnerCode}>Добавить в очередь</button></div>{activeServiceOwnerCode ? <span className="source-badge service">Выбрано авто: {activeServiceOwnerCode}</span> : null}</div></article><article className="panel panel-wide"><div className="timeline">{state.serviceQueue.length ? state.serviceQueue.map((item) => <div className="timeline-item" key={item.id}><div><strong>{item.workType}</strong><p>{item.customer} • {item.carLabel}</p><p className="muted">{item.scheduledAt}</p></div><div className="admin-badges"><span className={`source-badge ${item.status === 'ready' ? 'service' : item.status === 'in_service' ? 'warning' : 'neutral'}`}>{queueStatusLabel(item.status)}</span><span className="source-badge neutral">{item.ownerCode}</span><button className="ghost-button compact" onClick={() => setActiveServiceOwnerCode(item.ownerCode)}>Выбрать авто</button><button className="ghost-button compact" onClick={() => setQueueStatus(item.id, 'confirmed')}>Подтвердить</button><button className="ghost-button compact" onClick={() => setQueueStatus(item.id, 'in_service')}>В работу</button><button className="ghost-button compact" onClick={() => setQueueStatus(item.id, 'ready')}>Готово</button></div></div>) : <EmptyState title="Очередь пока пустая" text="Добавьте владельца по ID, и запись сразу появится в рабочем списке." />}</div></article></section> : null}

            {state.role === 'mechanic' && activeTab === 'history' ? <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Добавить работу</h2><p className="muted">Сохраняется по выбранному owner ID и может быть подтверждена в истории владельца.</p></div><Wrench size={22} /></div><div className="cloud-card"><div className="field-row"><input value={serviceWorkTitle} onChange={(event) => setServiceWorkTitle(event.target.value)} placeholder="Например: Замена масла и фильтра" /></div><div className="field-row"><input value={serviceWorkDetails} onChange={(event) => setServiceWorkDetails(event.target.value)} placeholder="Детали работы" /></div>{activeServiceOwnerCode ? <span className="source-badge service">ID владельца: {activeServiceOwnerCode}</span> : <span className="source-badge neutral">Сначала выберите авто в разделе Клиенты</span>}<button className="primary-button" onClick={saveServiceWork}>Сохранить работу</button></div></article><article className="panel panel-wide"><div className="timeline">{state.recentJobs.length ? state.recentJobs.map((job) => <div className="timeline-item" key={job.id}><div><strong>{job.title}</strong><p>{job.carLabel}</p><p className="muted">{job.finishedAt}</p></div><span className={`source-badge ${job.verified ? 'service' : 'neutral'}`}>{job.verified ? 'Подтверждено' : 'Ждет облака'}</span></div>) : <EmptyState title="Завершенных работ еще нет" text="Когда вы сохраните первую выполненную работу, она появится здесь." />}</div></article></section> : null}

            {state.role === 'service_admin' && activeTab === 'overview' ? <section className="grid"><article className="panel panel-wide"><div className="panel-heading"><div><h2>СТО и команда</h2><p className="muted">{state.serviceCenter.city || 'Город не указан'}, {state.serviceCenter.address || 'адрес уточняется'}</p></div><Users size={22} /></div><div className="vehicle-grid"><div><span>Часы работы</span><strong>{state.serviceCenter.workingHours || 'Не указаны'}</strong></div><div><span>Телефон</span><strong>{state.serviceCenter.phone || 'Не указан'}</strong></div><div><span>Постов</span><strong>{state.serviceCenter.bays || '—'}</strong></div><div><span>Активных заказов</span><strong>{state.serviceCenter.activeOrders || 0}</strong></div></div><div className="timeline">{state.staff.map((member) => <div className="timeline-item" key={member.id}><div><strong>{member.name}</strong><p>{member.role === 'mechanic' ? 'Механик' : member.role === 'service_admin' ? 'Администратор' : 'Сотрудник'}</p><p className="muted">{member.specialization} • {member.shift} • {member.workplace}</p></div><div className="admin-badges"><span className="source-badge neutral">{member.companyName}</span><span className={`source-badge ${member.workStatus === 'on_shift' ? 'service' : member.workStatus === 'off_shift' ? 'neutral' : 'self'}`}>{member.workStatus === 'on_shift' ? 'На смене' : member.workStatus === 'off_shift' ? 'Не в смене' : 'Выходной'}</span><span className="source-badge neutral">{member.salaryRub.toLocaleString('ru-RU')} ₽</span></div></div>)}</div></article><article className="panel"><div className="panel-heading"><div><h2>Добавить сотрудника</h2><p className="muted">Новые сотрудники попадают в локальный операционный список СТО.</p></div><Plus size={20} /></div><div className="cloud-card"><div className="field-row"><input value={employeeDraft.name} onChange={(event) => setEmployeeDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Имя сотрудника" /></div><div className="field-row"><select value={employeeDraft.role} onChange={(event) => setEmployeeDraft((current) => ({ ...current, role: event.target.value as StaffRoleOption }))}><option value="mechanic">Механик</option><option value="staff">Сотрудник</option><option value="service_admin">Администратор</option></select></div><div className="field-row"><input value={employeeDraft.specialization} onChange={(event) => setEmployeeDraft((current) => ({ ...current, specialization: event.target.value }))} placeholder="Специализация" /></div><div className="field-row"><input value={employeeDraft.shift} onChange={(event) => setEmployeeDraft((current) => ({ ...current, shift: event.target.value }))} placeholder="График" /></div><div className="field-row"><input value={employeeDraft.salaryRub} onChange={(event) => setEmployeeDraft((current) => ({ ...current, salaryRub: event.target.value }))} placeholder="Оклад" /></div><button className="primary-button" onClick={addEmployee}>Добавить сотрудника</button></div></article></section> : null}

            {state.role === 'service_admin' && activeTab === 'maintenance' ? <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Добавить по owner ID</h2><p className="muted">ID владельца помогает быстро находить машину, историю и очередь.</p></div><ScanLine size={22} /></div><div className="cloud-card"><div className="field-row"><input value={clientLookupCode} onChange={(event) => setClientLookupCode(event.target.value)} placeholder="UUID владельца" /></div><div className="hero-actions"><button className="ghost-button" onClick={scanOwnerQr} disabled={isScanningQr}>{isScanningQr ? 'Сканируем...' : 'Считать QR'}</button><button className="primary-button" onClick={addClientByOwnerCode}>Добавить в очередь</button></div>{activeServiceOwnerCode ? <span className="source-badge service">Выбрано авто: {activeServiceOwnerCode}</span> : null}</div></article><article className="panel panel-wide"><div className="panel-heading"><div><h2>Клиенты и очередь</h2><p className="muted">В одном месте видно базу клиентов и текущий поток по постам.</p></div><Users size={22} /></div><div className="timeline">{state.clients.length ? state.clients.map((client) => <div className="timeline-item" key={client.id}><div><strong>{client.name}</strong><p>{client.phone} • {client.carLabel}</p><p className="muted">Последний визит: {client.lastVisit} • {client.serviceCenter}</p></div><div className="admin-badges"><span className="source-badge neutral">{client.ownerCode}</span><button className="ghost-button compact" onClick={() => setActiveServiceOwnerCode(client.ownerCode)}>Выбрать авто</button></div></div>) : <EmptyState title="Клиентов пока нет" text="Добавьте первого владельца по ID, и клиентская база начнет заполняться автоматически." />}</div><div className="timeline">{state.serviceQueue.length ? state.serviceQueue.map((item) => <div className="timeline-item" key={item.id}><div><strong>{item.workType}</strong><p>{item.customer} • {item.carLabel}</p><p className="muted">{item.scheduledAt}</p></div><div className="admin-badges"><span className={`source-badge ${item.status === 'ready' ? 'service' : item.status === 'in_service' ? 'warning' : 'neutral'}`}>{queueStatusLabel(item.status)}</span><span className="source-badge neutral">{item.ownerCode}</span><button className="ghost-button compact" onClick={() => setActiveServiceOwnerCode(item.ownerCode)}>Выбрать авто</button><button className="ghost-button compact" onClick={() => setQueueStatus(item.id, 'confirmed')}>Подтвердить</button><button className="ghost-button compact" onClick={() => setQueueStatus(item.id, 'in_service')}>В работу</button><button className="ghost-button compact" onClick={() => setQueueStatus(item.id, 'ready')}>Готово</button></div></div>) : <EmptyState title="Очередь свободна" text="Новых записей пока нет. Добавьте владельца по ID или дождитесь следующей записи." />}</div></article></section> : null}

            {state.role === 'service_admin' && activeTab === 'history' ? <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Логи и действия</h2><p className="muted">Кто что менял в сервисе, когда и по какому клиенту.</p></div><BadgeCheck size={22} /></div><div className="timeline">{state.activityLogs.filter((item) => item.scope === 'service').length ? state.activityLogs.filter((item) => item.scope === 'service').map((log) => <div className="timeline-item" key={log.id}><div><strong>{log.actor}</strong><p>{log.action}</p><p className="muted">{log.target} • {log.timestamp}</p></div></div>) : <EmptyState title="Логов пока нет" text="Здесь появятся действия команды, как только начнется работа по клиентам." />}</div></article><article className="panel"><div className="panel-heading"><div><h2>ФОТ по сотрудникам</h2><p className="muted">Быстрый обзор окладов и состава команды.</p></div><Users size={22} /></div><div className="timeline">{state.staff.map((member) => <div className="timeline-item" key={member.id}><div><strong>{member.name}</strong><p>{member.specialization}</p></div><strong>{member.salaryRub.toLocaleString('ru-RU')} ₽</strong></div>)}</div></article></section> : null}

            {state.role === 'company_admin' && activeTab === 'overview' ? <section className="grid"><article className="panel panel-wide"><div className="panel-heading"><div><h2>Компании в системе</h2><p className="muted">Общий срез подключенных СТО, их команды и статуса платформы.</p></div><Users size={22} /></div><div className="timeline">{state.companies.length ? state.companies.map((company) => <div className="timeline-item" key={company.id}><div><strong>{company.name}</strong><p>{company.city} • {company.address}</p><p className="muted">{company.employees} сотрудников • {company.owners} владельцев</p></div><span className={`source-badge ${company.status === 'healthy' ? 'service' : company.status === 'review' ? 'neutral' : 'self'}`}>{company.status === 'healthy' ? 'Норма' : company.status === 'review' ? 'Проверка' : 'Внимание'}</span></div>) : <EmptyState title="Подключенных компаний пока нет" text="Когда появятся первые СТО, они будут показаны здесь вместе со статусами." />}</div></article></section> : null}

            {state.role === 'company_admin' && activeTab === 'maintenance' ? <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Сотрудники по компаниям</h2><p className="muted">Кто работает в какой компании и на какой смене.</p></div><Users size={22} /></div><div className="timeline">{state.staff.map((member) => <div className="timeline-item" key={member.id}><div><strong>{member.name}</strong><p>{member.role === 'mechanic' ? 'Механик' : member.role === 'service_admin' ? 'Администратор СТО' : member.role === 'company_admin' ? 'Модератор' : 'Сотрудник'}</p><p className="muted">{member.workplace} • {member.shift}</p></div><div className="admin-badges"><span className="source-badge neutral">{member.companyName}</span><span className="source-badge neutral">{member.salaryRub.toLocaleString('ru-RU')} ₽</span></div></div>)}</div></article><article className="panel"><div className="panel-heading"><div><h2>Владельцы</h2><p className="muted">Обзор клиентской базы и привязки к компаниям.</p></div><BadgeCheck size={22} /></div><div className="timeline">{state.owners.map((owner) => <div className="timeline-item" key={owner.id}><div><strong>{owner.name}</strong><p>{owner.primaryVehicle}</p><p className="muted">{owner.city} • {owner.vehicles} авто • был в сети {owner.lastSeen}</p></div><div className="admin-badges"><span className="source-badge neutral">{owner.ownerCode}</span><span className="source-badge neutral">{owner.companyName}</span></div></div>)}</div></article></section> : null}

            {state.role === 'company_admin' && activeTab === 'history' ? <section className="grid"><article className="panel panel-wide"><div className="panel-heading"><div><h2>Логи платформы</h2><p className="muted">Действия компаний, сотрудников и модерации.</p></div><Cog size={22} /></div><div className="timeline">{state.activityLogs.length ? state.activityLogs.map((log) => <div className="timeline-item" key={log.id}><div><strong>{log.actor}</strong><p>{log.action}</p><p className="muted">{log.target} • {log.timestamp} • {log.scope}</p></div></div>) : <EmptyState title="Логи платформы пока пусты" text="Когда компании начнут работать в системе, действия появятся здесь." />}</div></article></section> : null}
          </main>

          <nav className="tabs tabs-bottom" style={{ '--tab-count': String(tabs.length) } as CSSProperties}>
            {tabs.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tabLabels[tab]}</button>)}
          </nav>
        </>
      )}
    </div>
  );
}

export default App;

