import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import {
  BadgeCheck, Check, ChevronDown, ChevronUp, Cog, LogIn, Moon, Pencil, Plus,
  Save, Sparkles, SunMedium, Trash2, Users, Wrench, X,
} from 'lucide-react';
import { availableCarColors, resolveCarVisual, vehicleBrandOptions } from './data/carCatalog';
import { demoState } from './data/demoData';
import {
  addServiceRecordByOwnerCode, addVehicleToServiceIntake, bootstrapDemoGarage, deleteCloudAccountData, getCurrentSession,
  humanizeCloudError, isSupabaseEnabled, loadGarageStateFromCloud, saveOwnerProfile, saveStaffProfile,
  signInWithGoogle, signOutCloud, subscribeToAuthChanges, updateServiceQueueStatus, upsertVehiclePart,
} from './lib/cloud';
import { clearGarageState, loadGarageState, saveGarageState } from './lib/db';
import type { GarageState, MaintenanceTask, Part, StaffMember, UserRole } from './types';

type TabKey = 'overview' | 'parts' | 'maintenance' | 'history' | 'assistant';
type ThemeMode = 'light' | 'dark';
type StaffRoleOption = 'mechanic' | 'staff' | 'service_admin';
type PartDraft = { name: string; oem: string; manufacturer: string; price: string; note: string };

const ownerTabs = ['overview', 'parts', 'maintenance', 'history', 'assistant'] as const;
const mechanicTabs = ['overview', 'parts', 'maintenance', 'history', 'assistant'] as const;
const adminTabs = ['overview', 'maintenance', 'history', 'assistant'] as const;
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

function maintenanceProgress(task: MaintenanceTask, mileageKm: number) {
  const traveled = mileageKm - task.lastDoneKm;
  return Math.min(Math.max((traveled / task.intervalKm) * 100, 0), 100);
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
  const [syncStatus, setSyncStatus] = useState(isSupabaseEnabled ? 'Готово к входу через Google.' : 'Демо-режим');
  const [hasCloudProfile, setHasCloudProfile] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPassportExpanded, setIsPassportExpanded] = useState(false);
  const [isVehicleEditorOpen, setIsVehicleEditorOpen] = useState(false);
  const [expandedMaintenanceId, setExpandedMaintenanceId] = useState<string | null>('to-1');
  const [quickCommand, setQuickCommand] = useState('');
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLog, setAssistantLog] = useState<string[]>(['Помощник готов к быстрым командам.']);
  const [profileName, setProfileName] = useState('Алексей Ковалев');
  const [serviceCenterName, setServiceCenterName] = useState('Nord Garage');
  const [serviceCenterCity, setServiceCenterCity] = useState('Москва');
  const [serviceCenterBays, setServiceCenterBays] = useState('6');
  const [ownerPartDraft, setOwnerPartDraft] = useState<PartDraft>(emptyPartDraft());
  const [servicePartDraft, setServicePartDraft] = useState<PartDraft>(emptyPartDraft());
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [editingPartDraft, setEditingPartDraft] = useState<PartDraft>(emptyPartDraft());
  const [employeeDraft, setEmployeeDraft] = useState({ name: '', role: 'mechanic' as StaffRoleOption, specialization: '', shift: '09:00 - 18:00', workplace: 'Москва, ул. Шипиловская, 12', salaryRub: '90000' });
  const [clientLookupCode, setClientLookupCode] = useState('');
  const [ownerQrCode, setOwnerQrCode] = useState('');
  const [isScanningQr, setIsScanningQr] = useState(false);
  const [activeServiceOwnerCode, setActiveServiceOwnerCode] = useState('');
  const [serviceWorkTitle, setServiceWorkTitle] = useState('');
  const [serviceWorkDetails, setServiceWorkDetails] = useState('');
  const assistantRef = useRef<HTMLElement | null>(null);

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
      setProfileName(state.role === 'service_admin' ? 'Админ СТО' : 'Модератор');
      setServiceCenterName(state.serviceCenter.name);
      setServiceCenterCity(state.serviceCenter.city);
      setServiceCenterBays(String(state.serviceCenter.bays));
    }
  }, [state.role, state.ownerName, state.mechanicName, state.serviceCenter.name, state.serviceCenter.city, state.serviceCenter.bays]);
  useEffect(() => { saveGarageState(state).catch(() => undefined); }, [state]);
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
      if (!next) { setIsAuthReady(true); return; }
      const cloudState = await loadGarageStateFromCloud();
      if (cloudState) { setState(cloudState); setHasCloudProfile(true); setSyncStatus('Профиль загружен из облака.'); }
      setIsAuthReady(true);
    }).catch((error: Error) => setSyncStatus(humanizeCloudError(error)));
    return subscribeToAuthChanges((next) => {
      setSession(next);
      if (!next?.user?.email) { setHasCloudProfile(false); setSyncStatus('Вы не вошли.'); setIsAuthReady(true); return; }
      setIsAuthReady(true);
      setSyncStatus(`Вы вошли как ${next.user.email}.`);
      void loadGarageStateFromCloud().then((cloudState) => {
        if (cloudState) { setState(cloudState); setHasCloudProfile(true); }
      }).catch((error) => setSyncStatus(humanizeCloudError(error)));
    });
  }, []);

  const roleLabel = state.role === 'owner' ? 'Владелец' : state.role === 'mechanic' ? 'Механик' : state.role === 'service_admin' ? 'Админ СТО' : 'Модератор';
  const carVisual = resolveCarVisual(state.vehicle.brand);
  const selectedBrandOption = vehicleBrandOptions.find((item) => item.brand === state.vehicle.brand) ?? vehicleBrandOptions[0];
  const tabs = state.role === 'owner' ? ownerTabs : state.role === 'mechanic' ? mechanicTabs : adminTabs;
  const showOnboarding = isAuthReady && Boolean(session) && !hasCloudProfile;
  const allowRoleSwitchInSettings = !session;
  const currentDisplayName = hasCloudProfile
    ? state.role === 'owner'
      ? state.ownerName
      : state.role === 'mechanic'
        ? state.mechanicName
        : profileName
    : session?.user?.user_metadata?.full_name ?? profileName;
  const tabLabels =
    state.role === 'service_admin'
      ? { overview: 'СТО', parts: 'Детали', maintenance: 'Клиенты', history: 'Логи', assistant: 'Заметки' }
      : state.role === 'company_admin'
        ? { overview: 'Компании', parts: 'Детали', maintenance: 'Люди', history: 'Логи', assistant: 'Заметки' }
        : defaultTabLabels;

  function presentCloudError(error: unknown, fallback: string) {
    setSyncStatus(humanizeCloudError(error) || fallback);
  }

  function switchRole(role: UserRole) {
    setState((current) => ({ ...current, role, approvalStatus: role === 'mechanic' ? 'pending' : 'approved' }));
    setActiveTab('overview');
    setIsSettingsOpen(false);
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
          setState(cloudState);
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
          setState(cloudState);
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
      vehicle: {
        ...current.vehicle,
        brand,
        model: option?.models[0] ?? current.vehicle.model,
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
          setState(cloudState);
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
          setState(cloudState);
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
    setEmployeeDraft({ name: '', role: 'mechanic', specialization: '', shift: '09:00 - 18:00', workplace: 'Москва, ул. Шипиловская, 12', salaryRub: '90000' });
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
      if (cloudState) { setState(cloudState); setHasCloudProfile(true); }
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
        const nextVin = state.vehicle.vin && state.vehicle.vin !== demoState.vehicle.vin
          ? state.vehicle.vin
          : generateStableVin(session.user.id);
        await saveOwnerProfile({
          profileName,
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
        setState((current) => ({ ...current, ownerName: profileName, vehicle: { ...current.vehicle, vin: nextVin } }));
      } else if (state.role === 'mechanic') {
        await bootstrapDemoGarage(profileName.trim(), 'mechanic');
        setState((current) => ({ ...current, mechanicName: profileName, approvalStatus: 'pending' }));
      } else {
        await saveStaffProfile({
          profileName,
          role: state.role,
          serviceCenterName,
          serviceCenterCity,
          serviceCenterBays: Number.parseInt(serviceCenterBays, 10) || 1,
        });
        setState((current) => ({
          ...current,
          serviceCenter: {
            ...current.serviceCenter,
            name: serviceCenterName,
            city: serviceCenterCity,
            bays: Number.parseInt(serviceCenterBays, 10) || 1,
          },
        }));
      }
      setHasCloudProfile(true);
      const cloudState = await loadGarageStateFromCloud();
      if (cloudState) {
        setState(cloudState);
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

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand-lockup"><p className="eyebrow">CodexCar</p><strong>{roleLabel}</strong><span className="muted">{currentDisplayName}</span></div>
        <div className="auth-strip">
          <span className={`pill ${session ? 'approved' : 'pending'}`}>{session?.user?.email ?? 'Не вошли'}</span>
          {!session ? <button className="primary-button compact" onClick={signIn}><LogIn size={16} />Войти / регистрация</button> : null}
          <button className="theme-toggle" onClick={() => setIsSettingsOpen((current) => !current)}><Cog size={18} /></button>
          <button className="theme-toggle" onClick={() => setThemeMode((current) => current === 'light' ? 'dark' : 'light')}>{themeMode === 'light' ? <Moon size={18} /> : <SunMedium size={18} />}</button>
        </div>
      </div>

      {isSettingsOpen && <section className="settings-panel"><div className="panel-heading"><div><h2>Настройки</h2><p className="muted">Тема, цвет машины и управление аккаунтом.</p></div><Cog size={22} /></div><div className="settings-grid">{allowRoleSwitchInSettings ? <div><span className="settings-label">Режим</span><div className="segmented"><button className={state.role === 'owner' ? 'active' : ''} onClick={() => switchRole('owner')}>Владелец</button><button className={state.role === 'mechanic' ? 'active' : ''} onClick={() => switchRole('mechanic')}>Механик</button><button className={state.role === 'service_admin' ? 'active' : ''} onClick={() => switchRole('service_admin')}>Админ СТО</button><button className={state.role === 'company_admin' ? 'active' : ''} onClick={() => switchRole('company_admin')}>Модератор</button></div></div> : <div><span className="settings-label">Аккаунт</span><div className="owner-code-card"><strong>{roleLabel}</strong><p className="muted">{currentDisplayName}</p></div></div>}<div><span className="settings-label">Цвет машины</span><div className="color-picker">{availableCarColors.map((color) => <button key={color} className={state.vehicle.color === color ? 'color-swatch active' : 'color-swatch'} onClick={() => setState((current) => ({ ...current, vehicle: { ...current.vehicle, color } }))}>{color}</button>)}</div></div></div><div className="settings-footer">{session ? <button className="danger-button" onClick={logout}><LogIn size={16} />Выйти</button> : null}<button className="danger-button" onClick={deleteAccount}><Trash2 size={16} />Удалить аккаунт и данные</button></div></section>}

      {showOnboarding ? (
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
              <div className="assistant-input"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder={state.role === 'mechanic' ? 'Имя механика' : state.role === 'owner' ? 'Имя владельца' : state.role === 'service_admin' ? 'Имя админа СТО' : 'Имя модератора'} /></div>
              {state.role === 'owner' && (
                <>
                  <div className="assistant-input"><select value={state.vehicle.brand} onChange={(event) => updateVehicleBrand(event.target.value)}>{vehicleBrandOptions.map((option) => <option key={option.brand} value={option.brand}>{option.brand}</option>)}</select></div>
                  <div className="assistant-input"><select value={state.vehicle.model} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, model: event.target.value } }))}>{selectedBrandOption.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></div>
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
                <button className="primary-button" onClick={finishOnboarding} disabled={isSavingProfile}>{isSavingProfile ? 'Сохраняем...' : 'Сохранить профиль'}</button>
              </div>
            </div>
          </section>
        </section>
      ) : (
        <>
      <section className="quick-command"><div className="quick-command-copy"><h2>Быстрое действие</h2><p className="muted">Например: `поменял сегодня масло 5W40`.</p></div><div className="assistant-input quick-command-input"><input value={quickCommand} onChange={(event) => setQuickCommand(event.target.value)} placeholder="Что произошло?" /><button className="primary-button" onClick={applyQuickCommand}>Выполнить</button></div></section>

      <header className="hero-card">
        <div className="hero-copy"><h1>{state.role === 'owner' ? 'Машина и обслуживание в одном месте' : state.role === 'mechanic' ? 'Работы и детали в одном кабинете' : 'Команда и сервис без лишнего шума'}</h1><p className="hero-text">{syncStatus}</p><div className="hero-actions"><button className="primary-button" onClick={() => assistantRef.current?.scrollIntoView({ behavior: 'smooth' })}><Sparkles size={18} />Открыть помощника</button><button className="ghost-button" onClick={refreshCloud} disabled={!session}>Обновить</button></div></div>
        <div className="hero-panel">{state.role === 'owner' ? <div className="vehicle-card hero-passport"><button className="passport-toggle" onClick={() => setIsPassportExpanded((current) => !current)}><div className="passport-collapsed"><div className="passport-visual" style={{ backgroundColor: carVisual.accent }}><img src={carVisual.image} alt={`${state.vehicle.brand} showcase`} /></div><div><strong>{state.vehicle.brand} {state.vehicle.model}</strong><p>{state.vehicle.plate}</p></div></div>{isPassportExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>{isPassportExpanded && <div className="passport-expanded"><div className="vehicle-grid passport-details"><div><span>ID владельца</span><strong>{state.vehicle.ownerCode}</strong></div><div><span>VIN</span><strong>{state.vehicle.vin}</strong></div><div><span>Пробег</span><strong>{state.vehicle.mileageKm.toLocaleString('ru-RU')} км</strong></div><div><span>Двигатель</span><strong>{state.vehicle.engine}</strong></div><div><span>Цвет</span><strong>{state.vehicle.color}</strong></div><div><span>Осмотр</span><strong>{state.vehicle.nextInspection}</strong></div></div><div className="passport-share"><div className="owner-code-card"><strong>{state.vehicle.ownerCode}</strong><p className="muted">Этот ID можно вводить вручную или считывать по QR.</p></div>{ownerQrCode ? <div className="qr-card"><img src={ownerQrCode} alt="QR владельца" /><p className="muted">QR с ID владельца</p></div> : null}</div><div className="panel-heading passport-edit-heading"><div><h2>Сведения об авто</h2><p className="muted">Редактирование собрано прямо внутри карточки автомобиля.</p></div><button className="ghost-button compact" onClick={() => setIsVehicleEditorOpen((current) => !current)}><Pencil size={14} />{isVehicleEditorOpen ? 'Свернуть' : 'Изменить'}</button></div>{isVehicleEditorOpen && <div className="cloud-card"><div className="assistant-input"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Имя владельца" /></div><div className="assistant-input"><select value={state.vehicle.brand} onChange={(event) => updateVehicleBrand(event.target.value)}>{vehicleBrandOptions.map((option) => <option key={option.brand} value={option.brand}>{option.brand}</option>)}</select></div><div className="assistant-input"><select value={state.vehicle.model} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, model: event.target.value } }))}>{selectedBrandOption.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></div><div className="assistant-input"><input value={state.vehicle.plate} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, plate: event.target.value } }))} placeholder="Номер" /></div><div className="assistant-input"><input value={state.vehicle.vin} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, vin: event.target.value.toUpperCase() } }))} placeholder="VIN" /></div><div className="assistant-input"><input value={String(state.vehicle.mileageKm)} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, mileageKm: Number.parseInt(event.target.value, 10) || 0 } }))} placeholder="Пробег" /></div><div className="assistant-input"><input value={state.vehicle.engine} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, engine: event.target.value } }))} placeholder="Двигатель" /></div><button className="primary-button" onClick={() => { setState((current) => ({ ...current, ownerName: profileName })); setSyncStatus('Изменения автомобиля сохранены локально.'); setIsVehicleEditorOpen(false); }}>Сохранить сведения</button></div>}</div>}</div> : <div className="vehicle-card"><div className="vehicle-title">{state.role === 'mechanic' ? <Wrench size={20} /> : <Users size={20} />}<strong>{state.serviceCenter.name}</strong></div><p>{state.serviceCenter.city}</p><div className="vehicle-grid"><div><span>Постов</span><strong>{state.serviceCenter.bays}</strong></div><div><span>Ожидают механика</span><strong>{state.staff.filter((item) => item.role === 'mechanic' && item.approvalStatus === 'pending').length}</strong></div></div></div>}</div>
      </header>

      <nav className="tabs tabs-top">{tabs.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tabLabels[tab]}</button>)}</nav>

      <main className="dashboard">
        {state.role === 'owner' && activeTab === 'overview' && <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>ID владельца</h2><p className="muted">Обычный ID для тестов и тот же код внутри QR.</p></div><BadgeCheck size={22} /></div><div className="owner-code-card"><strong>{state.vehicle.ownerCode}</strong><p className="muted">{state.ownerName} • {state.vehicle.brand} {state.vehicle.model}</p></div></article></section>}
        {state.role === 'owner' && activeTab === 'parts' && <section className="grid"><article className="panel panel-wide"><div className="panel-heading"><div><h2>Добавить деталь</h2><p className="muted">Получит желтую галочку: менял сам.</p></div><Plus size={20} /></div><div className="cloud-card"><div className="assistant-input"><input value={ownerPartDraft.name} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Название" /></div><div className="assistant-input"><input value={ownerPartDraft.oem} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, oem: event.target.value }))} placeholder="OEM" /></div><div className="assistant-input"><input value={ownerPartDraft.manufacturer} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Производитель" /></div><div className="assistant-input"><input value={ownerPartDraft.price} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Цена" /></div><div className="assistant-input"><input value={ownerPartDraft.note} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Заметка" /></div><button className="primary-button" onClick={() => addPart('self')}>Добавить</button></div></article><article className="panel panel-wide"><div className="parts-grid">{state.parts.length ? state.parts.map(renderPartCard) : <EmptyState title="Деталей пока нет" text="Добавьте первую деталь выше, чтобы сохранить OEM, производителя и заметку по замене." />}</div></article></section>}
        {state.role === 'owner' && activeTab === 'maintenance' && <section className="grid"><article className="panel panel-wide maintenance-stack">{state.maintenance.length ? state.maintenance.map((task) => <article className="maintenance-card" key={task.id}><button className="maintenance-toggle" onClick={() => setExpandedMaintenanceId((current) => current === task.id ? null : task.id)}><div><strong>{task.title}</strong><p className="muted">{task.dueAtKm.toLocaleString('ru-RU')} км</p></div>{expandedMaintenanceId === task.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button><div className="progress-track"><div className="progress-bar" style={{ width: `${maintenanceProgress(task, state.vehicle.mileageKm)}%` }} /></div>{expandedMaintenanceId === task.id && <div className="maintenance-details"><ul className="stack-list">{task.items.map((item) => <li key={item}>{item}</li>)}</ul><p className="muted">{task.notes}</p></div>}</article>) : <EmptyState title="ТО пока не заполнено" text="После первой записи обслуживания здесь появятся регламентные работы и интервалы пробега." />}</article></section>}
        {state.role === 'owner' && activeTab === 'history' && <section className="grid"><article className="panel panel-wide"><div className="timeline">{state.records.length ? state.records.map((record) => <div className="timeline-item" key={record.id}><div><strong>{record.title}</strong><p>{record.date} • {record.location} • {record.mechanic}</p><p className="muted">{record.details}</p></div><span className={`source-badge ${record.verified ? 'service' : 'neutral'}`}>{record.verified ? 'Подтверждено' : 'Черновик'}</span></div>) : <EmptyState title="История обслуживания пуста" text="Когда вы или сервис добавите первую работу, она появится в этом разделе." />}</div></article></section>}
        {state.role === 'owner' && activeTab === 'assistant' && <section className="grid" ref={assistantRef}><article className="panel panel-wide assistant-panel"><div className="assistant-log">{assistantLog.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}</div><div className="assistant-input"><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Введите запрос" /><button className="primary-button" onClick={() => { if (!assistantInput.trim()) return; setAssistantLog((current) => [...current, `Вы: ${assistantInput}`, `AI: ${assistantReply(assistantInput, state)}`]); setAssistantInput(''); }}>Отправить</button></div></article></section>}

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
