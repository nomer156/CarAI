import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import {
  BadgeCheck, Bot, CarFront, Check, ChevronDown, ChevronUp, Cog, Download, LogIn, Moon, Pencil, Plus,
  Save, Sparkles, SunMedium, Trash2, Users, Wrench, X,
} from 'lucide-react';
import { availableCarColors, resolveCarVisual, resolveRecommendedOil, vehicleBrandOptions } from './data/carCatalog';
import { demoState } from './data/demoData';
import {
  addServiceRecordByOwnerCode, addVehicleToServiceIntake, bootstrapDemoGarage, deleteCloudAccountData, getCurrentSession,
  humanizeCloudError, isSupabaseEnabled, loadGarageStateFromCloud, saveOwnerProfile, saveStaffProfile,
  signInWithGoogle, signOutCloud, subscribeToAuthChanges, updateServiceQueueStatus, upsertVehiclePart,
} from './lib/cloud';
import { clearGarageState, loadGarageState, saveGarageState } from './lib/db';
import { checkLocalAiHealth, getConfiguredAiBackendUrl, normalizeOwnerCommand, setConfiguredAiBackendUrl } from './lib/localAi';
import { buildOwnerExecutionPlan, heuristicNormalizeOwnerCommand } from './lib/ownerCommandEngine';
import type { OwnerExecutionPlan } from './lib/ownerCommandEngine';
import type { Car, GarageState, JournalRecord, MaintenanceTask, Part, StaffMember, UserRole } from './types';

type TabKey = 'overview' | 'parts' | 'maintenance' | 'history' | 'assistant';
type ThemeMode = 'light' | 'dark';
type StaffRoleOption = 'mechanic' | 'staff' | 'service_admin';
type PartDraft = { name: string; oem: string; manufacturer: string; price: string; note: string };
type QuickEntryDraft = { note: string; mileage: string; partName: string; cost: string; nextMileage: string; rating?: 'good' | 'bad' };

const ownerTabs = ['overview', 'parts', 'maintenance', 'history', 'assistant'] as const;
const mechanicTabs = ['overview', 'parts', 'maintenance', 'history', 'assistant'] as const;
const adminTabs = ['overview', 'maintenance', 'history', 'assistant'] as const;
const APP_VERSION = 'v0.1';
const defaultTabLabels: Record<TabKey, string> = {
  overview: 'Обзор',
  parts: 'Детали',
  maintenance: 'ТО',
  history: 'История',
  assistant: 'Помощник',
};

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
}

function formatTimelineDate(value: number) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
  }).format(value);
}

function emptyQuickEntryDraft(): QuickEntryDraft {
  return {
    note: '',
    mileage: '',
    partName: '',
    cost: '',
    nextMileage: '',
  };
}

function maintenanceProgress(task: MaintenanceTask, mileageKm: number) {
  const traveled = mileageKm - task.lastDoneKm;
  return Math.min(Math.max((traveled / task.intervalKm) * 100, 0), 100);
}

function remainingMileage(task: MaintenanceTask, mileageKm: number) {
  return Math.max(task.dueAtKm - mileageKm, 0);
}

function assistantReply(message: string, state: GarageState) {
  const text = message.toLowerCase();
  if (text.includes('масло') || text.includes('то')) return `Ближайшее ТО: ${state.maintenance[0].title}.`;
  if (text.includes('oem') || text.includes('детал')) return `Сохранено ${state.parts.length} деталей с OEM.`;
  return 'Помощник может быстро записывать ТО, детали и заметки.';
}

function emptyPartDraft(): PartDraft {
  return { name: '', oem: '', manufacturer: '', price: '', note: '' };
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
  const [syncStatus, setSyncStatus] = useState(isSupabaseEnabled ? 'Войдите через Google, чтобы открыть профиль и автомобиль.' : 'Облако не настроено.');
  const [hasCloudProfile, setHasCloudProfile] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPassportExpanded, setIsPassportExpanded] = useState(false);
  const [isVehicleEditorOpen, setIsVehicleEditorOpen] = useState(false);
  const [expandedMaintenanceId, setExpandedMaintenanceId] = useState<string | null>('to-1');
  const [quickEntryDraft, setQuickEntryDraft] = useState<QuickEntryDraft>(emptyQuickEntryDraft());
  const [isQuickEntryExpanded, setIsQuickEntryExpanded] = useState(false);
  const [isSavingQuickEntry, setIsSavingQuickEntry] = useState(false);
  const [pendingOwnerPlan, setPendingOwnerPlan] = useState<OwnerExecutionPlan | null>(null);
  const [editingJournalId, setEditingJournalId] = useState<string | null>(null);
  const [swipedRecordId, setSwipedRecordId] = useState<string | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [isLocalAiAvailable, setIsLocalAiAvailable] = useState(false);
  const [localAiStatus, setLocalAiStatus] = useState('Локальный ИИ не проверялся.');
  const [aiBackendUrl, setAiBackendUrl] = useState(() => getConfiguredAiBackendUrl());
  const [quickCommand, setQuickCommand] = useState('');
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLog, setAssistantLog] = useState<string[]>(['Помощник готов к быстрым командам.']);
  const [profileName, setProfileName] = useState('');
  const [serviceCenterName, setServiceCenterName] = useState('');
  const [serviceCenterCity, setServiceCenterCity] = useState('');
  const [serviceCenterBays, setServiceCenterBays] = useState('');
  const [ownerPartDraft, setOwnerPartDraft] = useState<PartDraft>(emptyPartDraft());
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
  const assistantRef = useRef<HTMLElement | null>(null);
  const quickEntryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { loadGarageState().then(setState).catch(() => setState(demoState)); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem('codexcar-theme', themeMode);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeMode === 'dark' ? '#10202b' : '#fff9f4');
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
  useEffect(() => { saveGarageState(state).catch(() => undefined); }, [state]);
  async function refreshAiHealth(targetUrl?: string) {
    if (targetUrl !== undefined) {
      setConfiguredAiBackendUrl(targetUrl);
      setAiBackendUrl(getConfiguredAiBackendUrl());
    }

    try {
      const result = await checkLocalAiHealth();
      if (!result.ok) throw new Error('Local AI unavailable');
      setAiBackendUrl(result.url);
      setIsLocalAiAvailable(true);
      setLocalAiStatus(`AI backend подключен: ${result.model}. URL: ${result.url}`);
    } catch {
      setIsLocalAiAvailable(false);
      setLocalAiStatus(`AI backend недоступен. После перезапуска tunnel URL может измениться, поэтому проверьте адрес в разделе "Локальный ИИ".`);
    }
  }

  useEffect(() => {
    void refreshAiHealth();
  }, []);
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
    if (!isSupabaseEnabled) return;
    getCurrentSession().then(async (next) => {
      setSession(next);
      if (!next) { setState(demoState); setHasCloudProfile(false); setIsAuthReady(true); return; }
      const cloudState = await loadGarageStateFromCloud();
      if (cloudState) {
        setState((current) => ({ ...cloudState, cars: current.cars, activeCarId: current.activeCarId, journal: current.journal }));
        setHasCloudProfile(true);
        setSyncStatus('Профиль загружен из облака.');
      } else {
        setState(demoState);
        setProfileName(next.user?.user_metadata?.full_name ?? '');
        setHasCloudProfile(false);
      }
      setIsAuthReady(true);
    }).catch((error: Error) => setSyncStatus(humanizeCloudError(error)));
    return subscribeToAuthChanges((next) => {
      setSession(next);
      if (!next?.user?.email) { setState(demoState); setHasCloudProfile(false); setSyncStatus('Вы не вошли.'); setIsAuthReady(true); return; }
      setIsAuthReady(true);
      setSyncStatus(`Вы вошли как ${next.user.email}.`);
      void loadGarageStateFromCloud().then((cloudState) => {
        if (cloudState) {
          setState((current) => ({ ...cloudState, cars: current.cars, activeCarId: current.activeCarId, journal: current.journal }));
          setHasCloudProfile(true);
        } else {
          setState(demoState);
          setProfileName(next.user?.user_metadata?.full_name ?? '');
          setHasCloudProfile(false);
        }
      }).catch((error) => setSyncStatus(humanizeCloudError(error)));
    });
  }, []);

  const roleLabel = state.role === 'owner' ? 'Владелец' : state.role === 'mechanic' ? 'Механик' : state.role === 'service_admin' ? 'Админ СТО' : 'Модератор';
  const topRoleLabel = session ? roleLabel : 'Гость';
  const activeCar = state.cars.find((car) => car.id === state.activeCarId) ?? state.cars[0];
  const ownerTimeline = state.journal
    .filter((record) => record.carId === (activeCar?.id ?? state.activeCarId))
    .sort((left, right) => right.createdAt - left.createdAt);
  const carVisual = resolveCarVisual(state.vehicle.brand);
  const selectedBrandOption = vehicleBrandOptions.find((item) => item.brand === state.vehicle.brand) ?? vehicleBrandOptions[0];
  const tabs = state.role === 'owner' ? ownerTabs : state.role === 'mechanic' ? mechanicTabs : adminTabs;
  const showOnboarding = isAuthReady && Boolean(session) && !hasCloudProfile;
  const showHeroCard = state.role !== 'owner' || activeTab === 'overview';
  const currentDisplayName = session
    ? hasCloudProfile
      ? state.role === 'owner'
        ? state.ownerName
        : state.role === 'mechanic'
          ? state.mechanicName
          : profileName
      : session.user?.user_metadata?.full_name ?? profileName
    : 'Войдите через Google';
  const tabLabels =
    state.role === 'owner'
      ? { overview: 'Лента', parts: 'Детали', maintenance: 'ТО', history: 'Сервис', assistant: 'Локальный ИИ' }
      : state.role === 'service_admin'
      ? { overview: 'СТО', parts: 'Детали', maintenance: 'Клиенты', history: 'Логи', assistant: 'Заметки' }
      : state.role === 'company_admin'
        ? { overview: 'Компании', parts: 'Детали', maintenance: 'Люди', history: 'Логи', assistant: 'Заметки' }
        : defaultTabLabels;
  const ownerSectionMeta: Partial<Record<TabKey, { title: string; text: string }>> = {
    parts: {
      title: 'Детали и OEM',
      text: 'Собирайте свои расходники, OEM-номера и заметки по замене без лишних полей.',
    },
    maintenance: {
      title: 'Регламент ТО',
      text: 'Здесь только понятный план обслуживания по пробегу: что делать, когда и что именно входит в каждое ТО.',
    },
    history: {
      title: 'Сервисная история',
      text: 'Хронология работ, подтвержденных сервисом, без кнопок-заглушек и лишнего шума.',
    },
    assistant: {
      title: 'Локальный ИИ',
      text: 'ИИ остается дополнительным ускорителем. Основная работа с машиной доступна и без него.',
    },
  };
  const nearestMaintenance = [...state.maintenance].sort((left, right) => left.dueAtKm - right.dueAtKm)[0];
  const verifiedRecords = state.records.filter((record) => record.verified).length;
  const latestRecord = [...state.records].sort((left, right) => right.date.localeCompare(left.date))[0];

  useEffect(() => {
    if (!showOnboarding && state.role === 'owner') {
      quickEntryInputRef.current?.focus();
    }
  }, [showOnboarding, state.role]);

  function presentCloudError(error: unknown, fallback: string) {
    setSyncStatus(humanizeCloudError(error) || fallback);
  }

  function mergeLocalOwnerState(current: GarageState, cloudState: GarageState) {
    return {
      ...cloudState,
      cars: current.cars.length ? current.cars : cloudState.cars,
      activeCarId: current.activeCarId || cloudState.activeCarId,
      journal: current.journal,
    };
  }

  function switchRole(role: UserRole) {
    setState((current) => ({ ...current, role, approvalStatus: role === 'mechanic' ? 'pending' : 'approved' }));
    setActiveTab('overview');
    setIsSettingsOpen(false);
  }

  function updateActiveCar(nextCar: Car) {
    setState((current) => ({
      ...current,
      activeCarId: nextCar.id,
      vehicle: {
        ...current.vehicle,
        brand: nextCar.brand ?? current.vehicle.brand,
        model: nextCar.model ?? current.vehicle.model,
      },
    }));
  }

  function addCarTemplate() {
    const carId = `car-${Date.now()}`;
    const brand = vehicleBrandOptions[0];
    const nextCar: Car = {
      id: carId,
      name: `Моя ${brand.brand} ${brand.models[0]}`,
      brand: brand.brand,
      model: brand.models[0],
    };

    setState((current) => ({
      ...current,
      cars: [nextCar, ...current.cars],
      activeCarId: carId,
      vehicle: {
        ...current.vehicle,
        brand: brand.brand,
        model: brand.models[0],
      },
    }));
    setSyncStatus('Добавлена новая машина для журнала.');
  }

  function exportRecords() {
    const payload = JSON.stringify(state.journal, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `codexcar-records-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setSyncStatus('Экспорт JSON подготовлен.');
  }

  function beginEditJournal(record: JournalRecord) {
    setEditingJournalId(record.id);
    setQuickEntryDraft({
      note: record.rawNote ?? record.note,
      mileage: record.mileage ? String(record.mileage) : '',
      partName: record.partName ?? '',
      cost: record.cost ? String(record.cost) : '',
      nextMileage: record.nextMileage ? String(record.nextMileage) : '',
      rating: record.rating,
    });
    setIsQuickEntryExpanded(true);
    setActiveTab('overview');
    quickEntryInputRef.current?.focus();
  }

  function removeJournalRecord(recordId: string) {
    setState((current) => ({
      ...current,
      journal: current.journal.filter((record) => record.id !== recordId),
    }));
    if (editingJournalId === recordId) {
      setEditingJournalId(null);
      setQuickEntryDraft(emptyQuickEntryDraft());
    }
    setSwipedRecordId(null);
    setSyncStatus('Запись удалена.');
  }

  async function saveQuickEntry() {
    const rawNote = quickEntryDraft.note.trim();
    if (!rawNote || !activeCar) return;

    setIsSavingQuickEntry(true);
    const draftMileage = quickEntryDraft.mileage ? Number.parseInt(quickEntryDraft.mileage, 10) || undefined : undefined;
    const draftCost = quickEntryDraft.cost ? Number.parseInt(quickEntryDraft.cost, 10) || undefined : undefined;
    const draftNextMileage = quickEntryDraft.nextMileage ? Number.parseInt(quickEntryDraft.nextMileage, 10) || undefined : undefined;
    const previousOilRecord = [...state.journal]
      .filter((record) => record.carId === activeCar.id && /масл/i.test(record.note))
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    const recommendedOil = resolveRecommendedOil(state.vehicle.brand, state.vehicle.model);

    let command = heuristicNormalizeOwnerCommand({
      text: rawNote,
      brand: state.vehicle.brand,
      model: state.vehicle.model,
      currentMileageKm: state.vehicle.mileageKm,
    });

    command = {
      ...command,
      rawText: rawNote,
      mileageKm: draftMileage ?? command.mileageKm,
      partName: quickEntryDraft.partName || command.partName,
      cost: draftCost ?? command.cost,
      nextMileage: draftNextMileage ?? command.nextMileage,
      category: command.category ?? 'manual',
    };

    if (isLocalAiAvailable) {
      try {
        const result = await normalizeOwnerCommand({
          text: rawNote,
          mileage: draftMileage ?? state.vehicle.mileageKm,
          brand: state.vehicle.brand,
          model: state.vehicle.model,
          lastOil: previousOilRecord?.partName,
          recommendedOil: recommendedOil?.label,
        });
        command = {
          ...result,
          rawText: rawNote,
          mileageKm: draftMileage ?? result.mileageKm,
          partName: quickEntryDraft.partName || result.partName,
          cost: draftCost ?? result.cost,
          nextMileage: draftNextMileage ?? result.nextMileage,
        };
      } catch {
        setLocalAiStatus('Локальный ИИ не ответил. Включен локальный разбор по правилам.');
      }
    }

    const plan = buildOwnerExecutionPlan({
      command,
      state,
      activeCarId: activeCar.id,
      editingJournalId,
    });

    const nextRecord: JournalRecord = {
      ...plan.record,
      rating: quickEntryDraft.rating ?? plan.record.rating,
      category: plan.record.category ?? 'manual',
    };

    const applyOwnerPlan = (targetPlan: OwnerExecutionPlan, targetRecord: JournalRecord) => {
      setState((current) => {
        const nextJournal = editingJournalId
          ? current.journal.map((record) => (record.id === editingJournalId ? targetRecord : record))
          : [targetRecord, ...current.journal];

        const nextVehicleMileageKm = targetPlan.updatedVehicleMileageKm && targetPlan.updatedVehicleMileageKm > current.vehicle.mileageKm
          ? targetPlan.updatedVehicleMileageKm
          : current.vehicle.mileageKm;

        const nextMaintenance = targetPlan.updateMaintenance
          ? current.maintenance.map((task) => task.id === 'to-1'
            ? {
              ...task,
              lastDoneKm: targetRecord.mileage ?? nextVehicleMileageKm,
              dueAtKm: targetRecord.nextMileage ?? ((targetRecord.mileage ?? nextVehicleMileageKm) + task.intervalKm),
              notes: `Последняя замена масла: ${new Date(targetRecord.createdAt).toLocaleDateString('ru-RU')} • ${targetRecord.partName ?? recommendedOil?.label ?? 'масло уточняется'}.`,
              priority: 'low' as const,
            }
            : task)
          : current.maintenance;

        const nextParts = targetPlan.partsToAdd.length ? [...targetPlan.partsToAdd, ...current.parts] : current.parts;

        return {
          ...current,
          journal: nextJournal,
          parts: nextParts,
          maintenance: nextMaintenance,
          vehicle: {
            ...current.vehicle,
            mileageKm: nextVehicleMileageKm,
          },
        };
      });

      setEditingJournalId(null);
      setQuickEntryDraft(emptyQuickEntryDraft());
      setIsQuickEntryExpanded(false);
      setSwipedRecordId(null);
      setPendingOwnerPlan(null);
      setIsSavingQuickEntry(false);
      setSyncStatus(isLocalAiAvailable ? `${targetPlan.feedback} Локальный ИИ помог нормализовать команду.` : `${targetPlan.feedback} Сработал локальный разбор без ИИ.`);
    };

    if (plan.requiresConfirmation) {
      setPendingOwnerPlan({
        ...plan,
        record: nextRecord,
      });
      setIsSavingQuickEntry(false);
      setSyncStatus(plan.confirmationReason ?? 'Нужно подтвердить действие.');
      return;
    }

    applyOwnerPlan(plan, nextRecord);
  }

  function applyTemplateRecord(note: string) {
    setQuickEntryDraft((current) => ({ ...current, note }));
    setIsQuickEntryExpanded(false);
    quickEntryInputRef.current?.focus();
  }

  function handleRecordSwipeStart(clientX: number) {
    setTouchStartX(clientX);
  }

  function handleRecordSwipeEnd(recordId: string, clientX: number) {
    if (touchStartX === null) return;
    const delta = clientX - touchStartX;
    setTouchStartX(null);

    if (delta >= 64) {
      const targetRecord = state.journal.find((record) => record.id === recordId);
      if (targetRecord) beginEditJournal(targetRecord);
      return;
    }

    if (delta <= -64) {
      setSwipedRecordId((current) => current === recordId ? null : recordId);
    }
  }

  async function addPart(source: 'self' | 'service') {
    const draft = source === 'self' ? ownerPartDraft : servicePartDraft;
    if (!draft.name.trim() || !draft.oem.trim()) return;
    const next: Part = { id: `part-${Date.now()}`, name: draft.name, oem: draft.oem, manufacturer: draft.manufacturer || 'Не указан', price: Number.parseInt(draft.price, 10) || 0, status: 'ok', note: draft.note || '', installationSource: source };
    if (session && hasCloudProfile) {
      const targetOwnerCode = source === 'service' ? activeServiceOwnerCode : undefined;
      if (source === 'service' && !targetOwnerCode) {
        setSyncStatus('Сначала выберите авто владельца по ID или QR.');
        return;
      }
      try {
        await upsertVehiclePart({
          ownerCode: targetOwnerCode,
          name: next.name,
          oem: next.oem,
          manufacturer: next.manufacturer,
          price: next.price,
          status: next.status,
          note: next.note,
          installationSource: next.installationSource,
        });
        const cloudState = await loadGarageStateFromCloud();
        if (cloudState && state.role === 'owner') {
          setState((current) => mergeLocalOwnerState(current, cloudState));
        } else {
          setState((current) => ({ ...current, parts: [next, ...current.parts] }));
        }
        setSyncStatus('Деталь сохранена в облаке.');
      } catch (error) {
        presentCloudError(error, 'Не удалось сохранить деталь.');
        return;
      }
    } else {
      setState((current) => ({ ...current, parts: [next, ...current.parts] }));
    }
    source === 'self' ? setOwnerPartDraft(emptyPartDraft()) : setServicePartDraft(emptyPartDraft());
  }

  function startEditingPart(part: Part) {
    setEditingPartId(part.id);
    setEditingPartDraft({
      name: part.name,
      oem: part.oem,
      manufacturer: part.manufacturer,
      price: String(part.price),
      note: part.note,
    });
  }

  async function savePartEdit() {
    if (!editingPartId || !editingPartDraft.name.trim() || !editingPartDraft.oem.trim()) return;
    const targetPart = state.parts.find((part) => part.id === editingPartId);
    if (!targetPart) return;
    const updatedPart: Part = {
      ...targetPart,
      name: editingPartDraft.name,
      oem: editingPartDraft.oem,
      manufacturer: editingPartDraft.manufacturer || 'Не указан',
      price: Number.parseInt(editingPartDraft.price, 10) || 0,
      note: editingPartDraft.note,
    };
    if (session && hasCloudProfile) {
      const targetOwnerCode = state.role === 'owner' ? undefined : activeServiceOwnerCode;
      if (state.role !== 'owner' && !targetOwnerCode) {
        setSyncStatus('Сначала выберите авто владельца по ID или QR.');
        return;
      }
      try {
        await upsertVehiclePart({
          ownerCode: targetOwnerCode,
          partId: targetPart.id,
          name: updatedPart.name,
          oem: updatedPart.oem,
          manufacturer: updatedPart.manufacturer,
          price: updatedPart.price,
          status: updatedPart.status,
          note: updatedPart.note,
          installationSource: updatedPart.installationSource,
        });
        const cloudState = await loadGarageStateFromCloud();
        if (cloudState && state.role === 'owner') {
          setState((current) => mergeLocalOwnerState(current, cloudState));
        } else {
          setState((current) => ({ ...current, parts: current.parts.map((part) => part.id === editingPartId ? updatedPart : part) }));
        }
        setSyncStatus('Изменения детали сохранены.');
      } catch (error) {
        presentCloudError(error, 'Не удалось обновить деталь.');
        return;
      }
    } else {
      setState((current) => ({ ...current, parts: current.parts.map((part) => part.id === editingPartId ? updatedPart : part) }));
    }
    setEditingPartId(null);
    setEditingPartDraft(emptyPartDraft());
  }

  function cancelPartEdit() {
    setEditingPartId(null);
    setEditingPartDraft(emptyPartDraft());
  }

  function updateVehicleBrand(brand: string) {
    const option = vehicleBrandOptions.find((item) => item.brand === brand);
    setState((current) => ({
      ...current,
      cars: current.cars.map((car) => car.id === current.activeCarId ? {
        ...car,
        brand,
        model: option?.models[0] ?? '',
        name: brand ? `Моя ${brand} ${option?.models[0] ?? ''}`.trim() : 'Новая машина',
      } : car),
      vehicle: {
        ...current.vehicle,
        brand,
        model: option?.models[0] ?? '',
      },
    }));
  }

  function addClientByOwnerCode() {
    const lookup = clientLookupCode.trim().toUpperCase();
    if (!lookup) return;
    if ((state.role === 'mechanic' || state.role === 'service_admin') && session && hasCloudProfile) {
      void addVehicleToServiceIntake({
        ownerCode: lookup,
        workType: 'Новая запись по owner-коду',
      }).then(async () => {
        const cloudState = await loadGarageStateFromCloud();
        if (cloudState) {
          setState((current) => mergeLocalOwnerState(current, cloudState));
        }
        setActiveServiceOwnerCode(lookup);
        setClientLookupCode('');
        setSyncStatus('Клиент и очередь сохранены в облаке.');
      }).catch((error) => {
        presentCloudError(error, 'Не удалось добавить клиента в очередь.');
      });
      return;
    }
    const owner = state.owners.find((item) => item.ownerCode.toUpperCase() === lookup)
      ?? (state.vehicle.ownerCode.toUpperCase() === lookup ? {
        id: 'owner-current',
        name: state.ownerName,
        ownerCode: state.vehicle.ownerCode,
        primaryVehicle: `${state.vehicle.brand} ${state.vehicle.model}`,
        companyName: state.serviceCenter.name,
        city: state.serviceCenter.city,
        vehicles: 1,
        lastSeen: 'сейчас',
      } : null);
    if (!owner) return;

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
        lastVisit: new Date().toISOString().slice(0, 10),
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
  }

  async function saveServiceWork() {
    if (!serviceWorkTitle.trim() || !activeServiceOwnerCode) {
      setSyncStatus('Сначала выберите авто владельца и заполните название работы.');
      return;
    }

    if (session && hasCloudProfile) {
      try {
        await addServiceRecordByOwnerCode({
          ownerCode: activeServiceOwnerCode,
          title: serviceWorkTitle,
          details: serviceWorkDetails,
          location: state.serviceCenter.name,
        });
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
        setSyncStatus('Работа сохранена в облаке.');
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
  }

  async function setQueueStatus(queueId: string, status: 'new' | 'confirmed' | 'in_service' | 'ready') {
    if (session && hasCloudProfile && (state.role === 'mechanic' || state.role === 'service_admin')) {
      try {
        await updateServiceQueueStatus({ queueId, status });
        const cloudState = await loadGarageStateFromCloud();
        if (cloudState) {
          setState((current) => mergeLocalOwnerState(current, cloudState));
        }
        setSyncStatus('Статус очереди обновлен.');
      } catch (error) {
        presentCloudError(error, 'Не удалось обновить статус очереди.');
      }
      return;
    }

    setState((current) => ({
      ...current,
      serviceQueue: current.serviceQueue.map((item) => item.id === queueId ? { ...item, status } : item),
    }));
  }

  async function scanOwnerQr() {
    const Detector = (window as Window & {
      BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>> };
    }).BarcodeDetector;

    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setSyncStatus('Сканирование QR не поддерживается на этом устройстве.');
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });

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
    setSyncStatus('QR не распознан. Можно ввести ID вручную.');
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
  }

  function applyQuickCommand() {
    const text = quickCommand.trim();
    if (!text) return;
    const oilMatch = text.match(/(\d{1,2}w[- ]?\d{2})/i);
    if (text.toLowerCase().includes('масло')) {
      const oil = oilMatch?.[1]?.toUpperCase() ?? 'масло';
      const today = new Date().toISOString().slice(0, 10);
      setState((current) => ({
        ...current,
        maintenance: current.maintenance.map((task) => task.id === 'to-1' ? { ...task, lastDoneKm: current.vehicle.mileageKm, dueAtKm: current.vehicle.mileageKm + task.intervalKm, notes: `Последняя запись: ${today}, масло ${oil}.`, priority: 'low' } : task),
      }));
      setAssistantLog((current) => [...current, `Команда: ${text}`, `Система: добавила запись о замене масла ${oil}.`]);
    } else {
      setAssistantLog((current) => [...current, `Команда: ${text}`, 'Система: команда сохранена как заметка.']);
    }
    setQuickCommand('');
  }

  async function signIn() {
    if (!isSupabaseEnabled) {
      setSyncStatus('Облако не настроено. Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в Cloudflare Pages.');
      return;
    }
    try { setSyncStatus('Переходим на вход через Google...'); await signInWithGoogle(); } catch (error) { presentCloudError(error, 'Ошибка входа.'); }
  }
  async function logout() { try { await signOutCloud(); setSession(null); setHasCloudProfile(false); setIsSettingsOpen(false); setSyncStatus('Вы вышли.'); } catch (error) { presentCloudError(error, 'Ошибка выхода.'); } }
  async function refreshCloud() {
    if (!session) return;
    try {
      const cloudState = await loadGarageStateFromCloud();
      if (cloudState) { setState((current) => mergeLocalOwnerState(current, cloudState)); setHasCloudProfile(true); }
      setSyncStatus('Данные обновлены.');
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
        setState((current) => ({
          ...current,
          ownerName: profileName.trim(),
          cars: current.cars.map((car) => car.id === current.activeCarId ? {
            ...car,
            brand: current.vehicle.brand,
            model: current.vehicle.model,
            name: `${current.vehicle.brand} ${current.vehicle.model}`.trim(),
          } : car),
          vehicle: { ...current.vehicle, vin: nextVin },
        }));
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
        setState((current) => ({
          ...current,
          serviceCenter: {
            ...current.serviceCenter,
            name: serviceCenterName.trim(),
            city: serviceCenterCity.trim(),
            bays: Number.parseInt(serviceCenterBays, 10) || 1,
          },
        }));
      }
      setHasCloudProfile(true);
      const cloudState = await loadGarageStateFromCloud();
      if (cloudState) {
        setState((current) => mergeLocalOwnerState(current, cloudState));
        setHasCloudProfile(true);
      }
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
      if (session) { await deleteCloudAccountData(); await signOutCloud(); }
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
      setSyncStatus('Аккаунт очищен. Можно зарегистрироваться заново.');
    } catch (error) {
      presentCloudError(error, 'Не удалось удалить аккаунт.');
    }
  }

  function renderPartCard(part: Part) {
    const sourceLabel = part.installationSource === 'self' ? 'Менял сам' : 'Сделано сертифицированным СТО';
    const sourceClass = part.installationSource === 'self' ? 'self' : 'service';
    const isEditing = editingPartId === part.id;
    return (
      <article className="part-card" key={part.id}>
        <div className="panel-heading">
          <div>
            <strong>{part.name}</strong>
            <p className="muted">{part.manufacturer}</p>
          </div>
          <div className="part-card-actions">
            <span className={`status-chip ${part.status}`}>{part.status}</span>
            <button className="ghost-button compact" onClick={() => startEditingPart(part)}><Pencil size={14} />Редактировать</button>
          </div>
        </div>
        {isEditing ? (
          <div className="cloud-card">
            <div className="assistant-input"><input value={editingPartDraft.name} onChange={(event) => setEditingPartDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Название" /></div>
            <div className="assistant-input"><input value={editingPartDraft.oem} onChange={(event) => setEditingPartDraft((current) => ({ ...current, oem: event.target.value }))} placeholder="OEM" /></div>
            <div className="assistant-input"><input value={editingPartDraft.manufacturer} onChange={(event) => setEditingPartDraft((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Производитель" /></div>
            <div className="assistant-input"><input value={editingPartDraft.price} onChange={(event) => setEditingPartDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Цена" /></div>
            <div className="assistant-input"><input value={editingPartDraft.note} onChange={(event) => setEditingPartDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Заметка" /></div>
            <div className="part-edit-actions">
              <button className="primary-button compact" onClick={savePartEdit}><Save size={14} />Сохранить</button>
              <button className="ghost-button compact" onClick={cancelPartEdit}><X size={14} />Отмена</button>
            </div>
          </div>
        ) : (
          <>
            <div className="detail-list"><div><span>OEM</span><strong>{part.oem}</strong></div><div><span>Цена</span><strong>{formatMoney(part.price)}</strong></div></div>
            <span className={`source-badge ${sourceClass}`}><Check size={14} />{sourceLabel}</span>
            <p className="muted">{part.note}</p>
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
        onTouchStart={(event) => handleRecordSwipeStart(event.changedTouches[0].clientX)}
        onTouchEnd={(event) => handleRecordSwipeEnd(record.id, event.changedTouches[0].clientX)}
      >
        <div className="journal-meta">
          <span className="source-badge neutral">{formatTimelineDate(record.createdAt)}</span>
          {record.mileage ? <span className="source-badge neutral">{record.mileage.toLocaleString('ru-RU')} км</span> : null}
          {record.source === 'ai' ? <span className="source-badge service"><Bot size={14} />AI</span> : null}
        </div>
        <strong>{record.note}</strong>
        <div className="journal-details">
          {record.partName ? <span>{record.partName}</span> : null}
          {record.cost ? <span>{formatMoney(record.cost)}</span> : null}
          {record.nextMileage ? <span>След. замена: {record.nextMileage.toLocaleString('ru-RU')} км</span> : null}
        </div>
        <div className="journal-footer">
          <label className="rating-toggle">
            <input
              type="checkbox"
              checked={record.rating === 'good'}
              onChange={() => setState((current) => ({
                ...current,
                journal: current.journal.map((item) => item.id === record.id ? { ...item, rating: item.rating === 'good' ? undefined : 'good' } : item),
              }))}
            />
            <span>Подошли</span>
          </label>
          <label className="rating-toggle">
            <input
              type="checkbox"
              checked={record.rating === 'bad'}
              onChange={() => setState((current) => ({
                ...current,
                journal: current.journal.map((item) => item.id === record.id ? { ...item, rating: item.rating === 'bad' ? undefined : 'bad' } : item),
              }))}
            />
            <span>Не подошли</span>
          </label>
          <span className={`source-badge ${record.rating === 'bad' ? 'self' : record.rating === 'good' ? 'service' : 'neutral'}`}>
            {record.rating === 'bad' ? '👎' : record.rating === 'good' ? '👍' : 'Без оценки'}
          </span>
        </div>
        {isSwiped ? (
          <div className="journal-actions">
            <button className="ghost-button compact" onClick={() => beginEditJournal(record)}><Pencil size={14} />Редактировать</button>
            <button className="danger-button compact" onClick={() => removeJournalRecord(record.id)}><Trash2 size={14} />Удалить</button>
          </div>
        ) : (
          <p className="muted journal-hint">Свайп влево: удалить. Свайп вправо: редактировать.</p>
        )}
      </article>
    );
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand-lockup"><p className="eyebrow">CodexCar</p><strong>{topRoleLabel}</strong><span className="muted">{currentDisplayName}</span></div>
        <div className="auth-strip">
          <span className={`pill ${session ? 'approved' : 'pending'}`}>{session?.user?.email ?? 'Не вошли'}</span>
          {!session ? <button className="primary-button compact" onClick={signIn}><LogIn size={16} />Войти / регистрация</button> : null}
          <button className="theme-toggle" onClick={() => setIsSettingsOpen((current) => !current)}><Cog size={18} /></button>
          <button className="theme-toggle" onClick={() => setThemeMode((current) => current === 'light' ? 'dark' : 'light')}>{themeMode === 'light' ? <Moon size={18} /> : <SunMedium size={18} />}</button>
        </div>
      </div>

      {isSettingsOpen && <section className="settings-panel"><div className="panel-heading"><div><h2>Настройки</h2><p className="muted">{session ? 'Тема, цвет машины и управление аккаунтом.' : 'Войдите через Google, чтобы открыть профиль и машину.'}</p></div><Cog size={22} /></div><div className="settings-grid">{session ? <div><span className="settings-label">Аккаунт</span><div className="owner-code-card"><strong>{roleLabel}</strong><p className="muted">{currentDisplayName}</p></div></div> : <div><span className="settings-label">Доступ</span><div className="owner-code-card"><strong>Пока только вход</strong><p className="muted">После авторизации откроются лента, автомобиль, детали, ТО и ИИ.</p></div></div>}<div><span className="settings-label">Цвет машины</span><div className="color-picker">{availableCarColors.map((color) => <button key={color} className={state.vehicle.color === color ? 'color-swatch active' : 'color-swatch'} onClick={() => setState((current) => ({ ...current, vehicle: { ...current.vehicle, color } }))}>{color}</button>)}</div></div></div><div className="settings-meta"><span className="source-badge neutral">Версия приложения: {APP_VERSION}</span></div><div className="settings-footer">{session ? <button className="danger-button" onClick={logout}><LogIn size={16} />Выйти</button> : null}{session ? <button className="danger-button" onClick={deleteAccount}><Trash2 size={16} />Удалить аккаунт и данные</button> : null}</div></section>}

      {!session ? null : showOnboarding ? (
        <section className="onboarding-screen">
          <section className="settings-panel onboarding-panel">
            <div className="panel-heading">
              <div>
                <h2>Завершите регистрацию</h2>
                <p className="muted">Сначала сохраним базовый профиль. Пока он не заполнен, остальные разделы недоступны.</p>
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
              <div className="assistant-input"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Ваше имя и фамилия" /></div>
              {state.role === 'owner' && (
                <>
                  <div className="assistant-input"><select value={state.vehicle.brand} onChange={(event) => updateVehicleBrand(event.target.value)}><option value="">Выберите марку</option>{vehicleBrandOptions.map((option) => <option key={option.brand} value={option.brand}>{option.brand}</option>)}</select></div>
                  <div className="assistant-input"><select value={state.vehicle.model} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, model: event.target.value } }))} disabled={!state.vehicle.brand}><option value="">{state.vehicle.brand ? 'Выберите модель' : 'Сначала выберите марку'}</option>{selectedBrandOption.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></div>
                  <div className="assistant-input"><input value={state.vehicle.plate} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, plate: event.target.value } }))} placeholder="Номер авто" /></div>
                  <div className="assistant-input"><input value={state.vehicle.vin} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, vin: event.target.value.toUpperCase() } }))} placeholder="VIN" /></div>
                </>
              )}
              {(state.role === 'service_admin' || state.role === 'company_admin') && (
                <>
                  <div className="assistant-input"><input value={serviceCenterName} onChange={(event) => setServiceCenterName(event.target.value)} placeholder="Название СТО" /></div>
                  <div className="assistant-input"><input value={serviceCenterCity} onChange={(event) => setServiceCenterCity(event.target.value)} placeholder="Город" /></div>
                  <div className="assistant-input"><input value={serviceCenterBays} onChange={(event) => setServiceCenterBays(event.target.value)} placeholder="Количество постов" /></div>
                </>
              )}
              <div className="hero-actions">
                <button className="primary-button" onClick={finishOnboarding} disabled={isSavingProfile || !profileName.trim() || (state.role === 'owner' && (!state.vehicle.brand || !state.vehicle.model)) || ((state.role === 'service_admin' || state.role === 'company_admin') && !serviceCenterName.trim())}>{isSavingProfile ? 'Сохраняем...' : 'Сохранить профиль'}</button>
              </div>
              <p className="muted onboarding-status">{syncStatus}</p>
            </div>
          </section>
        </section>
      ) : (
        <>
      {state.role !== 'owner' && <section className="quick-command"><div className="quick-command-copy"><h2>Быстрое действие</h2><p className="muted">Например: `поменял сегодня масло 5W40`.</p></div><div className="assistant-input quick-command-input"><input value={quickCommand} onChange={(event) => setQuickCommand(event.target.value)} placeholder="Что произошло?" /><button className="primary-button" onClick={applyQuickCommand}>Выполнить</button></div></section>}

      {showHeroCard ? <header className="hero-card">
        <div className="hero-copy"><h1>{state.role === 'owner' ? 'Машина и обслуживание в одном месте' : state.role === 'mechanic' ? 'Работы и детали в одном кабинете' : 'Команда и сервис без лишнего шума'}</h1><p className="hero-text">{syncStatus}</p><div className="hero-actions"><button className="primary-button" onClick={() => assistantRef.current?.scrollIntoView({ behavior: 'smooth' })}><Sparkles size={18} />Открыть помощника</button><button className="ghost-button" onClick={refreshCloud} disabled={!session}>Обновить</button></div></div>
        <div className="hero-panel">{state.role === 'owner' ? <div className="vehicle-card hero-passport"><button className="passport-toggle" onClick={() => setIsPassportExpanded((current) => !current)}><div className="passport-collapsed"><div className="passport-visual" style={{ backgroundColor: carVisual.accent }}><img src={carVisual.image} alt={`${state.vehicle.brand || 'Авто'} showcase`} /></div><div><strong>{`${state.vehicle.brand} ${state.vehicle.model}`.trim() || 'Ваш автомобиль'}</strong><p>{state.vehicle.plate || 'Номер появится после заполнения профиля'}</p></div></div>{isPassportExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>{isPassportExpanded && <div className="passport-expanded"><div className="vehicle-grid passport-details"><div><span>ID владельца</span><strong>{state.vehicle.ownerCode || 'Появится после регистрации'}</strong></div><div><span>VIN</span><strong>{state.vehicle.vin || 'Не указан'}</strong></div><div><span>Пробег</span><strong>{state.vehicle.mileageKm ? `${state.vehicle.mileageKm.toLocaleString('ru-RU')} км` : 'Не указан'}</strong></div><div><span>Двигатель</span><strong>{state.vehicle.engine || 'Не указан'}</strong></div><div><span>Цвет</span><strong>{state.vehicle.color}</strong></div><div><span>Осмотр</span><strong>{state.vehicle.nextInspection || 'Не указан'}</strong></div></div><div className="passport-share"><div className="owner-code-card"><strong>{state.vehicle.ownerCode || 'ID появится после регистрации'}</strong><p className="muted">Этот ID можно вводить вручную или считывать по QR.</p></div>{ownerQrCode ? <div className="qr-card"><img src={ownerQrCode} alt="QR владельца" /><p className="muted">QR с ID владельца</p></div> : null}</div><div className="panel-heading passport-edit-heading"><div><h2>Сведения об авто</h2><p className="muted">Редактирование собрано прямо внутри карточки автомобиля.</p></div><button className="ghost-button compact" onClick={() => setIsVehicleEditorOpen((current) => !current)}><Pencil size={14} />{isVehicleEditorOpen ? 'Свернуть' : 'Изменить'}</button></div>{isVehicleEditorOpen && <div className="cloud-card"><div className="assistant-input"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Ваше имя и фамилия" /></div><div className="assistant-input"><select value={state.vehicle.brand} onChange={(event) => updateVehicleBrand(event.target.value)}><option value="">Выберите марку</option>{vehicleBrandOptions.map((option) => <option key={option.brand} value={option.brand}>{option.brand}</option>)}</select></div><div className="assistant-input"><select value={state.vehicle.model} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, model: event.target.value } }))} disabled={!state.vehicle.brand}><option value="">{state.vehicle.brand ? 'Выберите модель' : 'Сначала выберите марку'}</option>{selectedBrandOption.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></div><div className="assistant-input"><input value={state.vehicle.plate} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, plate: event.target.value } }))} placeholder="Номер" /></div><div className="assistant-input"><input value={state.vehicle.vin} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, vin: event.target.value.toUpperCase() } }))} placeholder="VIN" /></div><div className="assistant-input"><input value={state.vehicle.mileageKm ? String(state.vehicle.mileageKm) : ''} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, mileageKm: Number.parseInt(event.target.value, 10) || 0 } }))} placeholder="Пробег" /></div><div className="assistant-input"><input value={state.vehicle.engine} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, engine: event.target.value } }))} placeholder="Двигатель" /></div><button className="primary-button" onClick={() => { setState((current) => ({ ...current, ownerName: profileName.trim() })); setSyncStatus('Изменения автомобиля сохранены локально.'); setIsVehicleEditorOpen(false); }}>Сохранить сведения</button></div>}</div>}</div> : <div className="vehicle-card"><div className="vehicle-title">{state.role === 'mechanic' ? <Wrench size={20} /> : <Users size={20} />}<strong>{state.serviceCenter.name || 'СТО появится после регистрации'}</strong></div><p>{state.serviceCenter.city || 'Сначала завершите профиль'}</p><div className="vehicle-grid"><div><span>Постов</span><strong>{state.serviceCenter.bays || '—'}</strong></div><div><span>Ожидают механика</span><strong>{state.staff.filter((item) => item.role === 'mechanic' && item.approvalStatus === 'pending').length}</strong></div></div></div>}</div>
      </header> : null}

      <nav className="tabs tabs-top">{tabs.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tabLabels[tab]}</button>)}</nav>

      <main className={state.role === 'owner' && activeTab === 'overview' ? 'dashboard dashboard-with-fab' : 'dashboard'}>
        {state.role === 'owner' && activeTab !== 'overview' && ownerSectionMeta[activeTab] ? (
          <section className="owner-context-card">
            <p className="eyebrow">CodexCar</p>
            <h2>{ownerSectionMeta[activeTab]?.title}</h2>
            <p className="muted">{ownerSectionMeta[activeTab]?.text}</p>
          </section>
        ) : null}
        {state.role === 'owner' && activeTab === 'overview' && (
          <section className="grid">
            <article className="panel panel-wide">
              <div className="panel-heading owner-entry-heading">
                <div>
                  <h2>Быстрая запись</h2>
                  <p className="muted">Одна строка, минимум тапов. ИИ может помочь позже, но запись уже сейчас полностью работает сама по себе.</p>
                </div>
              </div>
              <div className="owner-overview-actions owner-entry-actions">
                <div className="assistant-input car-selector">
                  <select value={activeCar?.id} onChange={(event) => {
                    const nextCar = state.cars.find((car) => car.id === event.target.value);
                    if (nextCar) updateActiveCar(nextCar);
                  }}>
                    {state.cars.map((car) => <option key={car.id} value={car.id}>{car.name}</option>)}
                  </select>
                </div>
                <button className="ghost-button compact" onClick={addCarTemplate}><CarFront size={14} />Новая машина</button>
              </div>
              <div className="quick-entry-shell">
                {pendingOwnerPlan ? (
                  <div className="pending-owner-plan">
                    <div className="panel-heading">
                      <div>
                        <h2>Подтвердите действие</h2>
                        <p className="muted">{pendingOwnerPlan.confirmationReason ?? 'Помощник подготовил действие и ждет подтверждения.'}</p>
                      </div>
                      <BadgeCheck size={20} />
                    </div>
                    <div className="pending-owner-summary">
                      {pendingOwnerPlan.summary?.map((line) => <span key={line} className="source-badge neutral">{line}</span>)}
                    </div>
                    <div className="hero-actions">
                      <button className="primary-button" onClick={() => {
                        const targetRecord = pendingOwnerPlan.record;
                        const targetPlan = pendingOwnerPlan;
                        setState((current) => {
                          const nextJournal = editingJournalId
                            ? current.journal.map((record) => (record.id === editingJournalId ? targetRecord : record))
                            : [targetRecord, ...current.journal];

                          const nextVehicleMileageKm = targetPlan.updatedVehicleMileageKm && targetPlan.updatedVehicleMileageKm > current.vehicle.mileageKm
                            ? targetPlan.updatedVehicleMileageKm
                            : current.vehicle.mileageKm;

                          const nextMaintenance = targetPlan.updateMaintenance
                            ? current.maintenance.map((task) => task.id === 'to-1'
                              ? {
                                ...task,
                                lastDoneKm: targetRecord.mileage ?? nextVehicleMileageKm,
                                dueAtKm: targetRecord.nextMileage ?? ((targetRecord.mileage ?? nextVehicleMileageKm) + task.intervalKm),
                                notes: `Последняя замена масла: ${new Date(targetRecord.createdAt).toLocaleDateString('ru-RU')} • ${targetRecord.partName ?? 'масло уточняется'}.`,
                                priority: 'low' as const,
                              }
                              : task)
                            : current.maintenance;

                          const nextParts = targetPlan.partsToAdd.length ? [...targetPlan.partsToAdd, ...current.parts] : current.parts;

                          return {
                            ...current,
                            journal: nextJournal,
                            parts: nextParts,
                            maintenance: nextMaintenance,
                            vehicle: {
                              ...current.vehicle,
                              mileageKm: nextVehicleMileageKm,
                            },
                          };
                        });
                        setEditingJournalId(null);
                        setQuickEntryDraft(emptyQuickEntryDraft());
                        setIsQuickEntryExpanded(false);
                        setSwipedRecordId(null);
                        setPendingOwnerPlan(null);
                        setSyncStatus(`${targetPlan.feedback} Действие подтверждено.`);
                      }}>Подтвердить</button>
                      <button className="ghost-button" onClick={() => {
                        setPendingOwnerPlan(null);
                        setSyncStatus('Действие отменено. Можно уточнить запись и попробовать снова.');
                      }}>Отменить</button>
                    </div>
                  </div>
                ) : null}
                <div className="assistant-input quick-entry-primary">
                  <input
                    ref={quickEntryInputRef}
                    value={quickEntryDraft.note}
                    onChange={(event) => setQuickEntryDraft((current) => ({ ...current, note: event.target.value }))}
                    placeholder="Например: поменял масло"
                  />
                  <button className="primary-button big-add-button" onClick={saveQuickEntry} disabled={isSavingQuickEntry || !quickEntryDraft.note.trim()}>
                    <Plus size={18} />
                    {editingJournalId ? 'Сохранить' : 'Добавить'}
                  </button>
                </div>
                <button className="ghost-button compact inline-toggle" onClick={() => setIsQuickEntryExpanded((current) => !current)}>
                  {isQuickEntryExpanded ? 'Скрыть детали' : 'Доп. поля'}
                </button>
                {isQuickEntryExpanded && (
                  <div className="quick-entry-optional">
                    <div className="assistant-input"><input value={quickEntryDraft.mileage} onChange={(event) => setQuickEntryDraft((current) => ({ ...current, mileage: event.target.value }))} placeholder="Пробег, км" /></div>
                    <div className="assistant-input"><input value={quickEntryDraft.partName} onChange={(event) => setQuickEntryDraft((current) => ({ ...current, partName: event.target.value }))} placeholder="Деталь / бренд" /></div>
                    <div className="assistant-input"><input value={quickEntryDraft.cost} onChange={(event) => setQuickEntryDraft((current) => ({ ...current, cost: event.target.value }))} placeholder="Стоимость" /></div>
                    <div className="assistant-input"><input value={quickEntryDraft.nextMileage} onChange={(event) => setQuickEntryDraft((current) => ({ ...current, nextMileage: event.target.value }))} placeholder="Следующая замена через, км" /></div>
                    <div className="segmented rating-segmented">
                      <button className={quickEntryDraft.rating === 'good' ? 'active' : ''} onClick={() => setQuickEntryDraft((current) => ({ ...current, rating: current.rating === 'good' ? undefined : 'good' }))}>Подошли</button>
                      <button className={quickEntryDraft.rating === 'bad' ? 'active' : ''} onClick={() => setQuickEntryDraft((current) => ({ ...current, rating: current.rating === 'bad' ? undefined : 'bad' }))}>Не подошли</button>
                    </div>
                  </div>
                )}
                <div className="owner-journal-meta">
                  <span className={`source-badge ${isLocalAiAvailable ? 'service' : 'neutral'}`}>{isLocalAiAvailable ? 'Локальный ИИ активен' : 'Локальный ИИ офлайн'}</span>
                  <span className="muted">{localAiStatus}</span>
                </div>
              </div>
            </article>
            <article className="panel panel-wide">
              <div className="panel-heading">
                <div>
                  <h2>Лента обслуживания</h2>
                  <p className="muted">Новые записи сверху. Свайп по карточке открывает действия.</p>
                </div>
                <button className="ghost-button compact" onClick={() => applyTemplateRecord('Поменял масло')}>
                  Поменял масло
                </button>
              </div>
              <div className="timeline journal-timeline">
                {ownerTimeline.length ? ownerTimeline.map(renderJournalCard) : <EmptyState title="Добавь первую запись" text="Начните с короткой заметки, например: поменял масло." />}
              </div>
            </article>
          </section>
        )}
        {state.role === 'owner' && activeTab === 'parts' && <section className="grid"><article className="panel panel-wide"><div className="panel-heading"><div><h2>Добавить деталь</h2><p className="muted">Получит желтую галочку: менял сам.</p></div><Plus size={20} /></div><div className="cloud-card"><div className="assistant-input"><input value={ownerPartDraft.name} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Название" /></div><div className="assistant-input"><input value={ownerPartDraft.oem} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, oem: event.target.value }))} placeholder="OEM" /></div><div className="assistant-input"><input value={ownerPartDraft.manufacturer} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Производитель" /></div><div className="assistant-input"><input value={ownerPartDraft.price} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Цена" /></div><div className="assistant-input"><input value={ownerPartDraft.note} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Заметка" /></div><button className="primary-button" onClick={() => addPart('self')}>Добавить</button></div></article><article className="panel panel-wide"><div className="parts-grid">{state.parts.length ? state.parts.map(renderPartCard) : <EmptyState title="Деталей пока нет" text="Добавьте первую деталь выше, чтобы сохранить OEM, производителя и заметку по замене." />}</div></article></section>}
        {state.role === 'owner' && activeTab === 'maintenance' && <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Что ближайшее</h2><p className="muted">Раздел только для просмотра: здесь собран понятный регламент без ручного добавления ТО.</p></div><BadgeCheck size={22} /></div><div className="maintenance-summary-grid"><div className="feature"><div><strong>{nearestMaintenance?.title ?? 'ТО не найдено'}</strong><p className="muted">Следующий обязательный визит</p></div><strong>{nearestMaintenance ? `${remainingMileage(nearestMaintenance, state.vehicle.mileageKm).toLocaleString('ru-RU')} км` : '—'}</strong></div><div className="feature"><div><strong>{state.vehicle.mileageKm.toLocaleString('ru-RU')} км</strong><p className="muted">Текущий пробег автомобиля</p></div><strong>{state.vehicle.nextInspection}</strong></div><div className="feature"><div><strong>{state.maintenance.length}</strong><p className="muted">Регламентных этапов уже подготовлено</p></div><strong>{verifiedRecords} записи СТО</strong></div></div></article><article className="panel panel-wide maintenance-stack">{state.maintenance.length ? [...state.maintenance].sort((left, right) => left.dueAtKm - right.dueAtKm).map((task) => <article className="maintenance-card" key={task.id}><button className="maintenance-toggle" onClick={() => setExpandedMaintenanceId((current) => current === task.id ? null : task.id)}><div><span className="maintenance-kicker">{task.title}</span><strong>{task.title} · {task.intervalKm.toLocaleString('ru-RU')} км</strong><p className="muted">Следующее выполнение до {task.dueAtKm.toLocaleString('ru-RU')} км</p></div>{expandedMaintenanceId === task.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button><div className="maintenance-meta-grid"><div><span>Осталось</span><strong>{remainingMileage(task, state.vehicle.mileageKm).toLocaleString('ru-RU')} км</strong></div><div><span>Последний раз</span><strong>{task.lastDoneKm.toLocaleString('ru-RU')} км</strong></div><div><span>Приоритет</span><strong>{task.priority === 'high' ? 'Высокий' : task.priority === 'medium' ? 'Средний' : 'Плановый'}</strong></div></div><div className="progress-track"><div className="progress-bar" style={{ width: `${maintenanceProgress(task, state.vehicle.mileageKm)}%` }} /></div>{expandedMaintenanceId === task.id && <div className="maintenance-details"><ul className="stack-list">{task.items.map((item) => <li key={item}>{item}</li>)}</ul><p className="muted">{task.notes}</p></div>}</article>) : <EmptyState title="ТО пока не заполнено" text="После первой записи обслуживания здесь появятся регламентные работы и интервалы пробега." />}</article></section>}
        {state.role === 'owner' && activeTab === 'maintenance' && <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Что ближайшее</h2><p className="muted">Раздел только для просмотра: регламент уже встроен, вручную добавлять ТО не нужно.</p></div><BadgeCheck size={22} /></div><div className="maintenance-summary-grid"><div className="feature"><div><strong>{nearestMaintenance?.title ?? 'ТО не найдено'}</strong><p className="muted">Следующий обязательный визит</p></div><strong>{nearestMaintenance ? `${remainingMileage(nearestMaintenance, state.vehicle.mileageKm).toLocaleString('ru-RU')} км` : '—'}</strong></div><div className="feature"><div><strong>{state.vehicle.mileageKm.toLocaleString('ru-RU')} км</strong><p className="muted">Текущий пробег автомобиля</p></div><strong>{state.vehicle.nextInspection}</strong></div><div className="feature"><div><strong>{state.maintenance.length}</strong><p className="muted">Этапов регламента уже подготовлено</p></div><strong>{verifiedRecords} записи СТО</strong></div></div><div className="owner-code-card maintenance-helper"><strong>Откуда берется ТО</strong><p className="muted">Этапы ТО уже зашиты в приложение по регламенту. Лента, детали и записи сервиса только обновляют даты и пробег последнего выполненного обслуживания.</p></div></article><article className="panel panel-wide maintenance-stack">{state.maintenance.length ? [...state.maintenance].sort((left, right) => left.dueAtKm - right.dueAtKm).map((task) => <article className="maintenance-card" key={task.id}><button className="maintenance-toggle" onClick={() => setExpandedMaintenanceId((current) => current === task.id ? null : task.id)}><div><span className="maintenance-kicker">{task.title}</span><strong>{task.title} · {task.intervalKm.toLocaleString('ru-RU')} км</strong><p className="muted">Следующее выполнение до {task.dueAtKm.toLocaleString('ru-RU')} км</p></div>{expandedMaintenanceId === task.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button><div className="maintenance-meta-grid"><div><span>Осталось</span><strong>{remainingMileage(task, state.vehicle.mileageKm).toLocaleString('ru-RU')} км</strong></div><div><span>Последний раз</span><strong>{task.lastDoneKm.toLocaleString('ru-RU')} км</strong></div><div><span>Приоритет</span><strong>{task.priority === 'high' ? 'Высокий' : task.priority === 'medium' ? 'Средний' : 'Плановый'}</strong></div></div><div className="progress-track"><div className="progress-bar" style={{ width: `${maintenanceProgress(task, state.vehicle.mileageKm)}%` }} /></div>{expandedMaintenanceId === task.id && <div className="maintenance-details"><ul className="stack-list">{task.items.map((item) => <li key={item}>{item}</li>)}</ul><p className="muted">{task.notes}</p></div>}</article>) : <EmptyState title="ТО пока не заполнено" text="Регламент появится автоматически, как только для автомобиля появятся базовые данные и первая запись обслуживания." />}</article></section>}
        {state.role === 'owner' && activeTab === 'history' && <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Сервисная сводка</h2><p className="muted">Только фактические визиты и подтвержденные работы без лишних кнопок.</p></div><Wrench size={22} /></div><div className="service-summary-grid"><div className="feature"><div><strong>{verifiedRecords}</strong><p className="muted">Подтвержденных работ</p></div></div><div className="feature"><div><strong>{latestRecord?.date ?? '—'}</strong><p className="muted">Последний визит в сервис</p></div></div><div className="feature"><div><strong>{latestRecord?.location ?? 'СТО не указано'}</strong><p className="muted">Последнее место обслуживания</p></div></div></div></article><article className="panel panel-wide"><div className="panel-heading"><div><h2>История обслуживания</h2><p className="muted">Каждая запись показывает дату, сервис, исполнителя и краткий итог работ.</p></div><BadgeCheck size={22} /></div><div className="service-history-stack">{state.records.length ? state.records.map((record) => <article className="service-history-card" key={record.id}><div className="service-history-head"><div><strong>{record.title}</strong><p>{record.date} • {record.location}</p></div><span className={`source-badge ${record.verified ? 'service' : 'neutral'}`}>{record.verified ? 'Подтверждено' : 'Черновик'}</span></div><div className="service-history-meta"><span>Мастер: {record.mechanic}</span><span>Авто: {state.vehicle.brand} {state.vehicle.model}</span></div><p className="muted">{record.details}</p></article>) : <EmptyState title="История обслуживания пуста" text="Когда вы или сервис добавите первую работу, она появится в этом разделе." />}</div></article></section>}
        {state.role === 'owner' && activeTab === 'assistant' && (
          <section className="grid" ref={assistantRef}>
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Локальный ИИ</h2>
                  <p className="muted">Работает через `Ollama` на вашем ПК и помогает разбирать короткие записи.</p>
                </div>
                <Bot size={22} />
              </div>
              <div className="cloud-card">
                <span className={`source-badge ${isLocalAiAvailable ? 'service' : 'neutral'}`}>{isLocalAiAvailable ? 'Подключен' : 'Недоступен'}</span>
                <p className="muted">{localAiStatus}</p>
                <p className="muted">Если ИИ недоступен, запись все равно сохраняется локально как обычная заметка.</p>
                <div className="assistant-input">
                  <input value={aiBackendUrl} onChange={(event) => setAiBackendUrl(event.target.value)} placeholder="http://127.0.0.1:11535 или https://your-ai.example.com" />
                  <button className="ghost-button" onClick={() => { void refreshAiHealth(aiBackendUrl); }}>Проверить URL</button>
                </div>
                <p className="muted">Можно оставить `localhost` для работы на вашем ПК или указать публичный tunnel URL для тестеров.</p>
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Экспорт</h2>
                  <p className="muted">JSON уже подготовлен под будущий PDF и выгрузку истории.</p>
                </div>
                <Download size={22} />
              </div>
              <div className="cloud-card">
                <button className="primary-button" onClick={exportRecords}><Download size={16} />Экспортировать записи</button>
                <p className="muted">Экспортируются все локальные записи по всем машинам владельца.</p>
              </div>
            </article>
          </section>
        )}

        {state.role === 'mechanic' && activeTab === 'overview' && <section className="grid"><article className="panel panel-wide"><div className="timeline">{state.mechanicTasks.length ? state.mechanicTasks.map((task) => <div className="timeline-item" key={task.id}><div><strong>{task.title}</strong><p>{task.carLabel} • {task.ownerName}</p><p className="muted">{task.bay} • {task.scheduledAt}</p></div><button className="ghost-button compact" onClick={() => setState((current) => ({ ...current, mechanicTasks: current.mechanicTasks.map((item) => item.id === task.id ? { ...item, status: 'done' } : item) }))}>Готово</button></div>) : <EmptyState title="Сегодня задач пока нет" text="Новые работы появятся здесь, как только администратор или вы добавите машину в очередь." />}</div></article></section>}
        {state.role === 'mechanic' && activeTab === 'parts' && <section className="grid"><article className="panel panel-wide"><div className="panel-heading"><div><h2>Добавить деталь</h2><p className="muted">Будет отмечена зеленой галочкой как работа СТО.</p></div><Plus size={20} /></div><div className="cloud-card"><div className="assistant-input"><input value={servicePartDraft.name} onChange={(event) => setServicePartDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Название" /></div><div className="assistant-input"><input value={servicePartDraft.oem} onChange={(event) => setServicePartDraft((current) => ({ ...current, oem: event.target.value }))} placeholder="OEM" /></div><div className="assistant-input"><input value={servicePartDraft.manufacturer} onChange={(event) => setServicePartDraft((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Производитель" /></div><div className="assistant-input"><input value={servicePartDraft.price} onChange={(event) => setServicePartDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Цена" /></div><div className="assistant-input"><input value={servicePartDraft.note} onChange={(event) => setServicePartDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Заметка" /></div><button className="primary-button" onClick={() => addPart('service')}>Добавить</button></div></article><article className="panel panel-wide"><div className="parts-grid">{state.parts.length ? state.parts.map(renderPartCard) : <EmptyState title="Деталей пока нет" text="Выберите авто владельца и добавьте первую установленную деталь." />}</div></article></section>}
        {state.role === 'mechanic' && activeTab === 'maintenance' && <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Добавить по owner-коду</h2><p className="muted">Можно ввести ID вручную или считать QR с карточки владельца.</p></div><BadgeCheck size={22} /></div><div className="cloud-card"><div className="assistant-input"><input value={clientLookupCode} onChange={(event) => setClientLookupCode(event.target.value)} placeholder="UUID владельца" /></div><div className="hero-actions"><button className="ghost-button" onClick={scanOwnerQr} disabled={isScanningQr}>{isScanningQr ? 'Сканируем...' : 'Считать QR'}</button><button className="primary-button" onClick={addClientByOwnerCode}>Добавить в очередь</button></div>{activeServiceOwnerCode ? <span className="source-badge service">Выбрано авто: {activeServiceOwnerCode}</span> : null}</div></article>{state.serviceQueue.length ? state.serviceQueue.map((item) => <article className="panel" key={item.id}><strong>{item.workType}</strong><p>{item.customer} • {item.carLabel}</p><p className="muted">{item.scheduledAt}</p><div className="admin-badges"><span className={`source-badge ${item.status === 'ready' ? 'service' : item.status === 'in_service' ? 'warning' : 'neutral'}`}>{item.status}</span><span className="source-badge neutral">{item.ownerCode}</span><button className="ghost-button compact" onClick={() => setActiveServiceOwnerCode(item.ownerCode)}>Выбрать авто</button><button className="ghost-button compact" onClick={() => setQueueStatus(item.id, 'confirmed')}>Подтвердить</button><button className="ghost-button compact" onClick={() => setQueueStatus(item.id, 'in_service')}>В работу</button><button className="ghost-button compact" onClick={() => setQueueStatus(item.id, 'ready')}>Готово</button></div></article>) : <article className="panel panel-wide"><EmptyState title="Очередь пока пустая" text="Добавьте владельца по ID, и запись сразу появится в рабочем списке." /></article>}</section>}
        {state.role === 'mechanic' && activeTab === 'history' && <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Добавить работу</h2><p className="muted">Сохраняется по выбранному ID владельца.</p></div><Wrench size={22} /></div><div className="cloud-card"><div className="assistant-input"><input value={serviceWorkTitle} onChange={(event) => setServiceWorkTitle(event.target.value)} placeholder="Например: Замена масла и фильтра" /></div><div className="assistant-input"><input value={serviceWorkDetails} onChange={(event) => setServiceWorkDetails(event.target.value)} placeholder="Детали работы" /></div>{activeServiceOwnerCode ? <span className="source-badge service">ID владельца: {activeServiceOwnerCode}</span> : <span className="source-badge neutral">Сначала выберите авто в разделе Клиенты</span>}<button className="primary-button" onClick={saveServiceWork}>Сохранить работу</button></div></article><article className="panel panel-wide"><div className="timeline">{state.recentJobs.length ? state.recentJobs.map((job) => <div className="timeline-item" key={job.id}><div><strong>{job.title}</strong><p>{job.carLabel}</p><p className="muted">{job.finishedAt}</p></div><span className={`source-badge ${job.verified ? 'service' : 'neutral'}`}>{job.verified ? 'Подтверждено' : 'Ждет подтверждения'}</span></div>) : <EmptyState title="Завершенных работ еще нет" text="Когда вы сохраните первую выполненную работу, она появится здесь." />}</div></article></section>}
        {state.role === 'mechanic' && activeTab === 'assistant' && <section className="grid" ref={assistantRef}><article className="panel panel-wide assistant-panel"><div className="assistant-log">{assistantLog.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}</div><div className="assistant-input"><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Рабочая заметка" /><button className="primary-button" onClick={() => { if (!assistantInput.trim()) return; setAssistantLog((current) => [...current, `Вы: ${assistantInput}`, `AI: ${assistantReply(assistantInput, state)}`]); setAssistantInput(''); }}>Сохранить</button></div></article></section>}

        {state.role === 'service_admin' && activeTab === 'overview' && <section className="grid"><article className="panel panel-wide"><div className="panel-heading"><div><h2>СТО и команда</h2><p className="muted">{state.serviceCenter.city}, {state.serviceCenter.address}</p></div><Users size={22} /></div><div className="vehicle-grid"><div><span>Часы работы</span><strong>{state.serviceCenter.workingHours}</strong></div><div><span>Телефон</span><strong>{state.serviceCenter.phone}</strong></div><div><span>Постов</span><strong>{state.serviceCenter.bays}</strong></div><div><span>Активных заказов</span><strong>{state.serviceCenter.activeOrders}</strong></div></div><div className="timeline">{state.staff.map((member) => <div className="timeline-item" key={member.id}><div><strong>{member.name}</strong><p>{member.role === 'mechanic' ? 'Механик' : member.role === 'service_admin' ? 'Администратор' : 'Сотрудник'}</p><p className="muted">{member.specialization} • {member.shift} • {member.workplace}</p></div><div className="admin-badges"><span className="source-badge neutral">{member.companyName}</span><span className={`source-badge ${member.workStatus === 'on_shift' ? 'service' : member.workStatus === 'off_shift' ? 'neutral' : 'self'}`}>{member.workStatus === 'on_shift' ? 'На смене' : member.workStatus === 'off_shift' ? 'Не в смене' : 'Выходной'}</span><span className="source-badge neutral">{member.salaryRub.toLocaleString('ru-RU')} ₽</span>{member.role === 'mechanic' && member.approvalStatus !== 'approved' && <button className="ghost-button compact" onClick={() => setState((current) => ({ ...current, staff: current.staff.map((item) => item.id === member.id ? { ...item, approvalStatus: 'approved' } : item) }))}>Подтвердить</button>}{member.role === 'mechanic' && member.approvalStatus !== 'inactive' && <button className="ghost-button compact" onClick={() => setState((current) => ({ ...current, staff: current.staff.map((item) => item.id === member.id ? { ...item, approvalStatus: 'inactive' } : item) }))}>Деактивировать</button>}</div></div>)}</div></article><article className="panel"><div className="panel-heading"><div><h2>Добавить сотрудника</h2><p className="muted">Не-механики добавляются как обычный персонал сервиса.</p></div><Plus size={20} /></div><div className="cloud-card"><div className="assistant-input"><input value={employeeDraft.name} onChange={(event) => setEmployeeDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Имя сотрудника" /></div><div className="assistant-input"><select value={employeeDraft.role} onChange={(event) => setEmployeeDraft((current) => ({ ...current, role: event.target.value as StaffRoleOption }))}><option value="mechanic">Механик</option><option value="staff">Сотрудник</option><option value="service_admin">Администратор</option></select></div><div className="assistant-input"><input value={employeeDraft.specialization} onChange={(event) => setEmployeeDraft((current) => ({ ...current, specialization: event.target.value }))} placeholder="Специализация" /></div><div className="assistant-input"><input value={employeeDraft.shift} onChange={(event) => setEmployeeDraft((current) => ({ ...current, shift: event.target.value }))} placeholder="График" /></div><div className="assistant-input"><input value={employeeDraft.salaryRub} onChange={(event) => setEmployeeDraft((current) => ({ ...current, salaryRub: event.target.value }))} placeholder="Оклад" /></div><button className="primary-button" onClick={addEmployee}>Добавить сотрудника</button></div></article></section>}
        {state.role === 'service_admin' && activeTab === 'maintenance' && <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Добавить по owner-коду</h2><p className="muted">Можно считать QR или ввести ID владельца вручную.</p></div><BadgeCheck size={22} /></div><div className="cloud-card"><div className="assistant-input"><input value={clientLookupCode} onChange={(event) => setClientLookupCode(event.target.value)} placeholder="UUID владельца" /></div><div className="hero-actions"><button className="ghost-button" onClick={scanOwnerQr} disabled={isScanningQr}>{isScanningQr ? 'Сканируем...' : 'Считать QR'}</button><button className="primary-button" onClick={addClientByOwnerCode}>Добавить в очередь</button></div>{activeServiceOwnerCode ? <span className="source-badge service">Выбрано авто: {activeServiceOwnerCode}</span> : null}</div></article><article className="panel panel-wide"><div className="panel-heading"><div><h2>Клиенты</h2><p className="muted">ID владельца помогает быстро находить машину и историю.</p></div><Wrench size={22} /></div><div className="timeline">{state.clients.length ? state.clients.map((client) => <div className="timeline-item" key={client.id}><div><strong>{client.name}</strong><p>{client.phone} • {client.carLabel}</p><p className="muted">Последний визит: {client.lastVisit} • {client.serviceCenter}</p></div><div className="admin-badges"><span className="source-badge neutral">{client.ownerCode}</span><button className="ghost-button compact" onClick={() => setActiveServiceOwnerCode(client.ownerCode)}>Выбрать авто</button></div></div>) : <EmptyState title="Клиентов пока нет" text="Добавьте первого владельца по ID, и клиентская база начнет заполняться автоматически." />}</div></article>{state.serviceQueue.length ? state.serviceQueue.map((item) => <article className="panel" key={item.id}><strong>{item.workType}</strong><p>{item.customer} • {item.carLabel}</p><p className="muted">{item.scheduledAt}</p><div className="admin-badges"><span className={`source-badge ${item.status === 'ready' ? 'service' : item.status === 'in_service' ? 'warning' : 'neutral'}`}>{item.status}</span><span className="source-badge neutral">{item.ownerCode}</span><button className="ghost-button compact" onClick={() => setActiveServiceOwnerCode(item.ownerCode)}>Выбрать авто</button><button className="ghost-button compact" onClick={() => setQueueStatus(item.id, 'confirmed')}>Подтвердить</button><button className="ghost-button compact" onClick={() => setQueueStatus(item.id, 'in_service')}>В работу</button><button className="ghost-button compact" onClick={() => setQueueStatus(item.id, 'ready')}>Готово</button></div></article>) : <article className="panel"><EmptyState title="Очередь свободна" text="Новых записей пока нет. Добавьте владельца по ID или дождитесь следующей записи." /></article>}</section>}
        {state.role === 'service_admin' && activeTab === 'history' && <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Логи и действия</h2><p className="muted">Кто что менял в сервисе.</p></div><BadgeCheck size={22} /></div><div className="timeline">{state.activityLogs.filter((item) => item.scope === 'service').map((log) => <div className="timeline-item" key={log.id}><div><strong>{log.actor}</strong><p>{log.action}</p><p className="muted">{log.target} • {log.timestamp}</p></div></div>)}</div></article><article className="panel"><div className="panel-heading"><div><h2>ФОТ по сотрудникам</h2><p className="muted">Стандартный обзор окладов команды.</p></div><Users size={22} /></div><div className="timeline">{state.staff.map((member) => <div className="timeline-item" key={member.id}><div><strong>{member.name}</strong><p>{member.specialization}</p></div><strong>{member.salaryRub.toLocaleString('ru-RU')} ₽</strong></div>)}</div></article></section>}
        {state.role === 'service_admin' && activeTab === 'assistant' && <section className="grid" ref={assistantRef}><article className="panel panel-wide assistant-panel"><div className="assistant-log">{assistantLog.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}</div><div className="assistant-input"><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Заметка администратора СТО" /><button className="primary-button" onClick={() => { if (!assistantInput.trim()) return; setAssistantLog((current) => [...current, `Вы: ${assistantInput}`, `AI: ${assistantReply(assistantInput, state)}`]); setAssistantInput(''); }}>Сохранить</button></div></article></section>}

        {state.role === 'company_admin' && activeTab === 'overview' && <section className="grid"><article className="panel panel-wide"><div className="panel-heading"><div><h2>Компании в системе</h2><p className="muted">Модератор видит подключенные СТО и их состояние.</p></div><Users size={22} /></div><div className="timeline">{state.companies.length ? state.companies.map((company) => <div className="timeline-item" key={company.id}><div><strong>{company.name}</strong><p>{company.city} • {company.address}</p><p className="muted">{company.employees} сотрудников • {company.owners} владельцев</p></div><span className={`source-badge ${company.status === 'healthy' ? 'service' : company.status === 'review' ? 'neutral' : 'self'}`}>{company.status === 'healthy' ? 'Норма' : company.status === 'review' ? 'Проверка' : 'Внимание'}</span></div>) : <EmptyState title="Подключенных компаний пока нет" text="Когда появятся первые СТО, модератор увидит их здесь вместе со статусами." />}</div></article></section>}
        {state.role === 'company_admin' && activeTab === 'maintenance' && <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>Сотрудники по компаниям</h2><p className="muted">Сразу видно, кто работает в какой компании и на какой смене.</p></div><Users size={22} /></div><div className="timeline">{state.staff.map((member) => <div className="timeline-item" key={member.id}><div><strong>{member.name}</strong><p>{member.role === 'mechanic' ? 'Механик' : member.role === 'service_admin' ? 'Администратор СТО' : member.role === 'company_admin' ? 'Модератор' : 'Сотрудник'}</p><p className="muted">{member.workplace} • {member.shift}</p></div><div className="admin-badges"><span className="source-badge neutral">{member.companyName}</span><span className="source-badge neutral">{member.salaryRub.toLocaleString('ru-RU')} ₽</span></div></div>)}</div></article><article className="panel"><div className="panel-heading"><div><h2>Владельцы</h2><p className="muted">Обзор клиентской базы и привязки к компаниям.</p></div><BadgeCheck size={22} /></div><div className="timeline">{state.owners.map((owner) => <div className="timeline-item" key={owner.id}><div><strong>{owner.name}</strong><p>{owner.primaryVehicle}</p><p className="muted">{owner.city} • {owner.vehicles} авто • был в сети {owner.lastSeen}</p></div><div className="admin-badges"><span className="source-badge neutral">{owner.ownerCode}</span><span className="source-badge neutral">{owner.companyName}</span></div></div>)}</div></article></section>}
        {state.role === 'company_admin' && activeTab === 'history' && <section className="grid"><article className="panel panel-wide"><div className="panel-heading"><div><h2>Логи платформы</h2><p className="muted">Действия компаний, сотрудников и модерации.</p></div><Cog size={22} /></div><div className="timeline">{state.activityLogs.map((log) => <div className="timeline-item" key={log.id}><div><strong>{log.actor}</strong><p>{log.action}</p><p className="muted">{log.target} • {log.timestamp} • {log.scope}</p></div></div>)}</div></article></section>}
        {state.role === 'company_admin' && activeTab === 'assistant' && <section className="grid" ref={assistantRef}><article className="panel panel-wide assistant-panel"><div className="assistant-log">{assistantLog.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}</div><div className="assistant-input"><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Заметка модератора" /><button className="primary-button" onClick={() => { if (!assistantInput.trim()) return; setAssistantLog((current) => [...current, `Вы: ${assistantInput}`, `AI: ${assistantReply(assistantInput, state)}`]); setAssistantInput(''); }}>Сохранить</button></div></article></section>}
      </main>
      <nav className="tabs tabs-bottom">{tabs.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tabLabels[tab]}</button>)}</nav>
        </>
      )}
    </div>
  );
}

export default App;
