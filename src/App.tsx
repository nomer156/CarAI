import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Activity, BadgeCheck, Bot, CalendarClock, CarFront, CheckCheck, CircleAlert, Cog,
  Gauge, ListTodo, Moon, PackageSearch, ShieldAlert, ShieldCheck, Sparkles, SunMedium,
  Users, Wrench,
} from 'lucide-react';
import { availableCarColors, carCatalog } from './data/carCatalog';
import { demoState } from './data/demoData';
import {
  bootstrapDemoGarage, bootstrapStaffAccount, getCurrentSession, isSupabaseEnabled, loadGarageStateFromCloud,
  saveOwnerProfile, saveStaffProfile, signInWithGoogle, signInWithMagicLink, signOutCloud, subscribeToAuthChanges,
} from './lib/cloud';
import { loadGarageState, saveGarageState } from './lib/db';
import type {
  AccidentRecord, DocumentRecord, GarageState, MaintenanceTask, MarketplaceOffer,
  Part, ServiceRecord, UserRole,
} from './types';

type TabKey = 'overview' | 'parts' | 'maintenance' | 'history' | 'assistant';
type ThemeMode = 'light' | 'dark';

const ownerTabs = [
  { key: 'overview', label: 'Обзор' },
  { key: 'parts', label: 'Детали' },
  { key: 'maintenance', label: 'ТО' },
  { key: 'history', label: 'История' },
  { key: 'assistant', label: 'ИИ' },
] as const;

const staffTabs = [
  { key: 'overview', label: 'Панель' },
  { key: 'history', label: 'Работы' },
  { key: 'maintenance', label: 'Очередь' },
  { key: 'assistant', label: 'Заметки' },
] as const;

const priorityLabels = { low: 'Планово', medium: 'Скоро', high: 'Срочно' } as const;

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
}

function getMaintenanceProgress(task: MaintenanceTask, mileageKm: number) {
  const traveled = mileageKm - task.lastDoneKm;
  return Math.min(Math.max((traveled / task.intervalKm) * 100, 0), 100);
}

function buildAssistantReply(message: string, state: GarageState) {
  const text = message.toLowerCase();
  const urgentPart = state.parts.find((part) => part.status === 'replace');
  const nextMaintenance = [...state.maintenance].sort((a, b) => a.dueAtKm - b.dueAtKm)[0];
  if (text.includes('масло') || text.includes('то')) {
    return `Следующее ТО лучше запланировать на ${nextMaintenance.dueAtKm.toLocaleString('ru-RU')} км. Сейчас пробег ${state.vehicle.mileageKm.toLocaleString('ru-RU')} км.`;
  }
  if (text.includes('детал') || text.includes('номер') || text.includes('oem')) {
    return urgentPart
      ? `Сначала закажите "${urgentPart.name}". OEM: ${urgentPart.oem}, ${urgentPart.manufacturer}, около ${formatMoney(urgentPart.price)}.`
      : 'Все критичные детали в норме. Могу подсказать OEM нужной позиции.';
  }
  if (text.includes('механик') || text.includes('сто')) {
    return 'Механик создает аккаунт сам, но доверенным он становится только после подтверждения админом СТО.';
  }
  return 'Я могу подсказывать сроки ТО, OEM-номера, состояние документов и список срочных работ.';
}

function App() {
  const [state, setState] = useState<GarageState>(demoState);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [assistantInput, setAssistantInput] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [profileName, setProfileName] = useState('Алексей Ковалев');
  const [serviceCenterName, setServiceCenterName] = useState('Nord Garage');
  const [serviceCenterCity, setServiceCenterCity] = useState('Москва');
  const [serviceCenterBays, setServiceCenterBays] = useState('6');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const savedTheme = window.localStorage.getItem('codexcar-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [quickCommand, setQuickCommand] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [hasCloudProfile, setHasCloudProfile] = useState(false);
  const [syncStatus, setSyncStatus] = useState(isSupabaseEnabled ? 'Облако подключено. Основной вход через Google, email оставлен как запасной.' : 'Демо-режим. Добавьте ключи Supabase в .env.');
  const [assistantLog, setAssistantLog] = useState<string[]>(['Я отслеживаю детали, ТО и сервисную историю. Спросите, что нужно заказать или когда ехать на обслуживание.']);
  const mainRef = useRef<HTMLElement | null>(null);
  const assistantRef = useRef<HTMLElement | null>(null);

  useEffect(() => { loadGarageState().then(setState).catch(() => setState(demoState)); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem('codexcar-theme', themeMode);
    const themeColor = themeMode === 'dark' ? '#10202b' : '#fff9f4';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  }, [themeMode]);
  useEffect(() => {
    if (state.role === 'owner') {
      setProfileName(state.ownerName);
    }
    if (state.role === 'mechanic') {
      setProfileName(state.mechanicName);
    }
    if (state.role === 'service_admin' || state.role === 'company_admin') {
      setServiceCenterName(state.serviceCenter.name);
      setServiceCenterCity(state.serviceCenter.city);
      setServiceCenterBays(String(state.serviceCenter.bays));
    }
  }, [state.role, state.ownerName, state.mechanicName, state.serviceCenter.name, state.serviceCenter.city, state.serviceCenter.bays]);
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    getCurrentSession().then(async (nextSession) => {
      setSession(nextSession);
      if (!nextSession) return;
      const cloudState = await loadGarageStateFromCloud();
      setHasCloudProfile(Boolean(cloudState));
      setSyncStatus(cloudState ? 'Состояние загружено из облака Supabase.' : 'Вы вошли, но профиль в облаке еще не создан.');
      if (cloudState) setState(cloudState);
    }).catch((error: Error) => setSyncStatus(`Ошибка инициализации облака: ${error.message}`));
    return subscribeToAuthChanges((nextSession) => {
      setSession(nextSession);
      if (!nextSession?.user?.email) {
        setHasCloudProfile(false);
        setSyncStatus('Сессия облака завершена. Вы работаете локально.');
        return;
      }
      setSyncStatus(`Вы вошли в облако как ${nextSession.user.email}. Загружаю профиль...`);
      void loadGarageStateFromCloud()
        .then((cloudState) => {
          if (cloudState) {
            setHasCloudProfile(true);
            setState(cloudState);
            setSyncStatus(`Вы вошли в облако как ${nextSession.user.email}. Профиль загружен.`);
            return;
          }
          setHasCloudProfile(false);
          setSyncStatus(`Вы вошли в облако как ${nextSession.user.email}. Профиль еще не создан.`);
        })
        .catch((error: Error) => setSyncStatus(`Ошибка загрузки облачного профиля: ${error.message}`));
    });
  }, []);
  useEffect(() => { saveGarageState(state).catch((error) => console.error('Failed to persist garage state', error)); }, [state]);

  const tabs = state.role === 'owner' ? ownerTabs : staffTabs;
  const urgentItems = state.parts.filter((part) => part.status === 'replace').length + state.maintenance.filter((task) => task.priority === 'high').length;
  const totalPartsValue = state.parts.reduce((sum, part) => sum + part.price, 0);
  const expiringDocuments = state.documents.filter((document) => document.expiresAt).slice(0, 2);
  const replaceIds = new Set(state.parts.filter((part) => part.status !== 'ok').map((part) => part.id));
  const recommendedOffers = state.offers.filter((offer) => replaceIds.has(offer.partId)).slice(0, 3);
  const trustScore = Math.max(35, Math.min(100, 52 + Math.min(state.records.filter((r) => r.verified).length * 12, 48) + Math.min(state.documents.filter((d) => d.verified).length * 10, 30) - state.accidents.length * 6));
  const pendingMechanics = state.staff.filter((member) => member.role === 'mechanic' && member.approvalStatus === 'pending');
  const activeQueue = state.serviceQueue.filter((item) => item.status !== 'ready');
  const activeTasks = state.mechanicTasks.filter((item) => item.status !== 'done');
  const roleLabel =
    state.role === 'owner'
      ? 'Владелец'
      : state.role === 'mechanic'
        ? 'Механик'
        : state.role === 'service_admin'
          ? 'Админ СТО'
          : 'Администратор компании';
  const normalizedRoleLabel = roleLabel;
  const brandKey = state.vehicle.brand.toLowerCase().includes('bmw')
    ? 'bmw'
    : state.vehicle.brand.toLowerCase().includes('mercedes')
      ? 'mercedes'
      : state.vehicle.brand.toLowerCase().includes('toyota')
        ? 'toyota'
        : 'default';
  const selectedCarVisual = carCatalog[brandKey] ?? carCatalog.default;
  const approvalText = state.role === 'owner'
    ? 'Владелец управляет автомобилем и делится доступом с сервисом.'
    : state.role === 'mechanic'
      ? state.approvalStatus === 'approved' ? 'Аккаунт механика подтвержден админом СТО.' : state.approvalStatus === 'inactive' ? 'Аккаунт механика деактивирован админом СТО.' : 'Аккаунт механика создан, но до подтверждения доступ ограничен.'
      : state.role === 'service_admin'
        ? 'Админ СТО управляет механиками, очередью, записью клиентов и настройками сервиса.'
        : 'Администратор компании контролирует СТО, роли, доступы и спорные ситуации.';

  function openTab(tab: TabKey) {
    setActiveTab(tab);
    requestAnimationFrame(() => {
      const target = tab === 'assistant' ? assistantRef.current : mainRef.current;
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function switchRole(role: UserRole) {
    setActiveTab('overview');
    setState((current) => ({ ...current, role, approvalStatus: role === 'owner' ? 'approved' : role === 'mechanic' ? 'pending' : 'approved' }));
    setIsSettingsOpen(false);
  }
  function toggleServiceRecord(id: string) {
    setState((current) => ({ ...current, records: current.records.map((record) => record.id === id ? { ...record, verified: !record.verified } : record) }));
  }
  function approveStaffMember(id: string) {
    setState((current) => ({ ...current, staff: current.staff.map((member) => member.id === id ? { ...member, approvalStatus: 'approved' } : member) }));
  }
  function deactivateStaffMember(id: string) {
    setState((current) => ({ ...current, staff: current.staff.map((member) => member.id === id ? { ...member, approvalStatus: 'inactive' } : member) }));
  }
  function submitAssistantPrompt() {
    if (!assistantInput.trim()) return;
    const reply = buildAssistantReply(assistantInput, state);
    setAssistantLog((current) => [...current, `Вы: ${assistantInput}`, `AI: ${reply}`]);
    setAssistantInput('');
    assistantRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function markTaskDone(taskId: string) {
    setState((current) => ({
      ...current,
      maintenance: current.maintenance.map((task) => task.id === taskId ? { ...task, lastDoneKm: current.vehicle.mileageKm, dueAtKm: current.vehicle.mileageKm + task.intervalKm, priority: 'low' } : task),
      mechanicTasks: current.mechanicTasks.map((task) => task.id === taskId ? { ...task, status: 'done' } : task),
    }));
  }
  function addQuickServiceRecord() {
    const newRecord: ServiceRecord = {
      id: `record-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      title: state.role === 'mechanic' ? 'Работы внесены механиком' : state.role === 'service_admin' ? 'Запись добавлена админом СТО' : 'Пользователь добавил запись',
      location: state.serviceCenter.name,
      mechanic: state.role === 'owner' ? state.ownerName : state.role === 'service_admin' ? 'Админ СТО' : state.mechanicName,
      verified: state.role !== 'mechanic' || state.approvalStatus === 'approved',
      details: 'Запись создана из интерфейса CodexCar.',
    };
    setState((current) => ({ ...current, records: [newRecord, ...current.records] }));
  }
  function applyQuickCommand() {
    const text = quickCommand.trim();
    if (!text) return;
    const normalized = text.toLowerCase();
    if (normalized.includes('поменял') && normalized.includes('масло')) {
      const oilMatch = text.match(/(\d{1,2}w[- ]?\d{2})/i);
      const oilName = oilMatch?.[1]?.toUpperCase() ?? 'масло';
      const today = new Date().toISOString().slice(0, 10);
      setState((current) => ({
        ...current,
        records: [
          {
            id: `record-${Date.now()}`,
            date: today,
            title: 'Замена масла',
            location: current.role === 'owner' ? 'Самостоятельно' : current.serviceCenter.name,
            mechanic: current.role === 'owner' ? current.ownerName : normalizedRoleLabel,
            verified: current.role !== 'mechanic' || current.approvalStatus === 'approved',
            details: `Через быстрый помощник добавлена запись: замена масла ${oilName}.`,
          },
          ...current.records,
        ],
        maintenance: current.maintenance.map((task) =>
          task.id === 'engine-oil'
            ? {
                ...task,
                lastDoneKm: current.vehicle.mileageKm,
                dueAtKm: current.vehicle.mileageKm + task.intervalKm,
                priority: 'low',
                notes: `Последняя запись: ${today}, масло ${oilName}.`,
              }
            : task,
        ),
      }));
      setAssistantLog((current) => [...current, `Команда: ${text}`, `Система: Добавила запись о замене масла ${oilName}.`]);
      setQuickCommand('');
      return;
    }
    setAssistantLog((current) => [...current, `Команда: ${text}`, 'Система: Команда сохранена как заметка.']);
    setQuickCommand('');
  }
  async function handleCloudLogin() {
    if (!authEmail.trim()) { setSyncStatus('Введите email для magic link.'); return; }
    try { await signInWithMagicLink(authEmail.trim()); setSyncStatus('Письмо для входа отправлено. Откройте magic link и вернитесь в приложение.'); }
    catch (error) { setSyncStatus(error instanceof Error ? error.message : 'Не удалось отправить magic link.'); }
  }
  async function handleGoogleLogin() {
    try {
      setSyncStatus('Переходим на вход через Google...');
      await signInWithGoogle();
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : 'Не удалось начать вход через Google.');
    }
  }
  async function handleCloudRefresh() {
    if (!session) { setSyncStatus('Сначала войдите в облачный аккаунт.'); return; }
    try {
      const cloudState = await loadGarageStateFromCloud();
      setSyncStatus(cloudState ? 'Данные обновлены из Supabase.' : 'В облаке пока нет данных для текущей роли.');
      if (cloudState) setState(cloudState);
    } catch (error) { setSyncStatus(error instanceof Error ? error.message : 'Не удалось обновить данные из облака.'); }
  }
  async function handleCloudLogout() {
    try { await signOutCloud(); setSyncStatus('Вы вышли из облака и продолжаете работать локально.'); }
    catch (error) { setSyncStatus(error instanceof Error ? error.message : 'Не удалось выйти из облака.'); }
  }
  async function handleCreateCloudGarage() {
    if (!session) { setSyncStatus('Сначала войдите в облако через Google или email.'); return; }
    if (!profileName.trim()) { setSyncStatus('Укажите имя профиля.'); return; }
    try {
      if (state.role === 'owner' || state.role === 'mechanic') {
        await bootstrapDemoGarage(profileName.trim(), state.role === 'owner' ? 'owner' : 'mechanic');
      }
      if (state.role === 'service_admin' || state.role === 'company_admin') {
        await bootstrapStaffAccount(profileName.trim(), state.role, serviceCenterName.trim(), serviceCenterCity.trim());
      }
      const cloudState = await loadGarageStateFromCloud();
      if (cloudState) {
        setHasCloudProfile(true);
        setState(cloudState);
      }
      setSyncStatus(
        state.role === 'owner'
          ? 'Профиль владельца и автомобиль созданы в Supabase.'
          : state.role === 'mechanic'
            ? 'Аккаунт механика создан и ожидает подтверждения админом СТО.'
            : state.role === 'service_admin'
              ? 'Профиль админа СТО и привязка к сервису созданы в Supabase.'
              : 'Профиль администратора компании создан в Supabase.',
      );
    } catch (error) { setSyncStatus(error instanceof Error ? error.message : 'Не удалось создать облачный профиль.'); }
  }
  async function handleSaveCloudProfile() {
    if (!session) {
      setSyncStatus('Сначала войдите в облако.');
      return;
    }

    try {
      if (state.role === 'owner') {
        await saveOwnerProfile({
          profileName: profileName.trim(),
          brand: state.vehicle.brand,
          model: state.vehicle.model,
          year: state.vehicle.year,
          vin: state.vehicle.vin,
          plate: state.vehicle.plate,
          mileageKm: state.vehicle.mileageKm,
          engine: state.vehicle.engine,
          color: state.vehicle.color,
          nextInspection: state.vehicle.nextInspection,
        });
      }

      if (state.role === 'service_admin' || state.role === 'company_admin') {
        await saveStaffProfile({
          profileName: profileName.trim(),
          role: state.role,
          serviceCenterName: serviceCenterName.trim(),
          serviceCenterCity: serviceCenterCity.trim(),
          serviceCenterBays: Number.parseInt(serviceCenterBays, 10) || 1,
        });
      }

      const cloudState = await loadGarageStateFromCloud();
      if (cloudState) {
        setHasCloudProfile(true);
        setState(cloudState);
      }
      setSyncStatus('Профиль сохранен в облаке.');
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : 'Не удалось сохранить профиль в облаке.');
    }
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand-lockup">
          <p className="eyebrow">CodexCar</p>
          <strong>{state.role === 'owner' ? 'Кабинет автомобиля' : state.role === 'mechanic' ? 'Рабочий кабинет механика' : state.role === 'service_admin' ? 'Кабинет админа СТО' : 'Кабинет администратора компании'}</strong>
        </div>
        <div className="topbar-actions">
          <span className={`pill ${state.approvalStatus}`}>{normalizedRoleLabel}</span>
          <button className="theme-toggle" onClick={() => setIsSettingsOpen((current) => !current)} aria-label="Открыть настройки">
            <Cog size={18} />
          </button>
          <button className="theme-toggle" onClick={() => setThemeMode((current) => current === 'light' ? 'dark' : 'light')} aria-label="Переключить тему">
            {themeMode === 'light' ? <Moon size={18} /> : <SunMedium size={18} />}
          </button>
        </div>
      </div>

      {isSettingsOpen && (
        <section className="settings-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Настройки</p>
              <h2>Служебные параметры и демо-режим</h2>
            </div>
            <Cog size={22} />
          </div>
          <div className="settings-grid">
            <div>
              <span className="settings-label">Режим аккаунта</span>
              <div className="segmented">
                <button className={state.role === 'owner' ? 'active' : ''} onClick={() => switchRole('owner')}>Владелец</button>
                <button className={state.role === 'mechanic' ? 'active' : ''} onClick={() => switchRole('mechanic')}>Механик</button>
                <button className={state.role === 'service_admin' ? 'active' : ''} onClick={() => switchRole('service_admin')}>Админ СТО</button>
                <button className={state.role === 'company_admin' ? 'active' : ''} onClick={() => switchRole('company_admin')}>Админ компании</button>
              </div>
            </div>
            <div>
              <span className="settings-label">Цвет машины</span>
              <div className="color-picker">
                {availableCarColors.map((color) => (
                  <button
                    key={color}
                    className={state.vehicle.color === color ? 'color-swatch active' : 'color-swatch'}
                    onClick={() => setState((current) => ({ ...current, vehicle: { ...current.vehicle, color } }))}
                  >
                    {color}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="quick-command">
        <div className="quick-command-copy">
          <p className="eyebrow">Быстрое действие</p>
          <h2>Напишите действие обычным языком</h2>
          <p className="muted">Например: `поменял сегодня масло 5W40` или `добавь запись о диагностике подвески`.</p>
        </div>
        <div className="assistant-input quick-command-input">
          <input value={quickCommand} onChange={(event) => setQuickCommand(event.target.value)} placeholder="Что произошло с машиной или заказом?" />
          <button className="primary-button" onClick={applyQuickCommand}>Выполнить</button>
        </div>
      </section>

      <header className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Роль</p>
          <h1>{state.role === 'owner' ? 'Все по машине в одном месте' : state.role === 'mechanic' ? 'Рабочие задачи и история ремонтов' : state.role === 'service_admin' ? 'Команда СТО, очередь и контроль качества' : 'Контроль СТО, ролей и доступа по всей компании'}</h1>
          <p className="hero-text">{approvalText}</p>
          <div className="hero-kpis">
            <div><span>{state.role === 'owner' ? 'Срочных задач' : state.role === 'mechanic' ? 'Активных задач' : 'Очередь'}</span><strong>{state.role === 'owner' ? urgentItems : state.role === 'mechanic' ? activeTasks.length : activeQueue.length}</strong></div>
            <div><span>{state.role === 'owner' ? 'Индекс доверия' : state.role === 'mechanic' ? 'Закрыто работ' : 'Механиков'}</span><strong>{state.role === 'owner' ? `${trustScore}/100` : state.role === 'mechanic' ? state.recentJobs.length : state.staff.filter((staff) => staff.role === 'mechanic').length}</strong></div>
            <div><span>{state.role === 'owner' ? 'Документов' : 'Ожидают подтверждения'}</span><strong>{state.role === 'owner' ? state.documents.length : pendingMechanics.length}</strong></div>
          </div>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => openTab('assistant')}><Sparkles size={18} />{state.role === 'owner' ? 'Открыть помощника' : 'Открыть заметки'}</button>
            <button className="ghost-button" onClick={() => openTab(state.role === 'owner' ? 'maintenance' : 'overview')}><Activity size={18} />{state.role === 'owner' ? 'Проверить ТО' : 'Открыть панель'}</button>
            <button className="ghost-button" onClick={addQuickServiceRecord}><BadgeCheck size={18} />Добавить запись</button>
          </div>
        </div>
        <div className="hero-panel">
          {state.role === 'owner' ? (
            <div className="vehicle-card">
              <div className="vehicle-visual" style={{ backgroundColor: selectedCarVisual.accent }}>
                <img src={selectedCarVisual.image} alt={`${state.vehicle.brand} showcase`} />
                <span className="color-badge">{state.vehicle.color}</span>
              </div>
              <div className="vehicle-title"><CarFront size={20} /><strong>{state.vehicle.brand} {state.vehicle.model}</strong></div>
              <p>{state.vehicle.year} • {state.vehicle.engine}</p>
              <div className="vehicle-grid">
                <div><span>Пробег</span><strong>{state.vehicle.mileageKm.toLocaleString('ru-RU')} км</strong></div>
                <div><span>VIN</span><strong>{state.vehicle.vin}</strong></div>
                <div><span>Номер</span><strong>{state.vehicle.plate}</strong></div>
                <div><span>Осмотр</span><strong>{state.vehicle.nextInspection}</strong></div>
              </div>
              <div className={`approval-card ${state.approvalStatus}`}><ShieldCheck size={18} /><p>{approvalText}</p></div>
            </div>
          ) : (
            <div className="vehicle-card">
              <div className="vehicle-title">{state.role === 'mechanic' ? <Wrench size={20} /> : <Users size={20} />}<strong>{state.serviceCenter.name}</strong></div>
              <p>{state.serviceCenter.city} • {state.serviceCenter.bays} постов</p>
              <div className="vehicle-grid">
                <div><span>Активных заказов</span><strong>{state.serviceCenter.activeOrders}</strong></div>
                <div><span>Очередь</span><strong>{state.serviceCenter.queueDepth}</strong></div>
                <div><span>Подтверждений</span><strong>{pendingMechanics.length}</strong></div>
                <div><span>Смена</span><strong>{state.role === 'mechanic' ? '09:00 - 18:00' : '08:00 - 17:00'}</strong></div>
              </div>
              <div className={`approval-card ${state.approvalStatus}`}>{state.role === 'mechanic' ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}<p>{approvalText}</p></div>
            </div>
          )}
        </div>
      </header>

      <nav className="tabs tabs-top">
        {tabs.map((tab) => (
          <button key={tab.key} className={activeTab === tab.key ? 'active' : ''} onClick={() => openTab(tab.key as TabKey)}>{tab.label}</button>
        ))}
      </nav>

      <main className="dashboard" ref={mainRef}>
        {state.role === 'owner' && activeTab === 'overview' && (
          <section className="grid">
            <article className="panel panel-wide">
              <div className="panel-heading"><div><p className="eyebrow">Быстрый старт</p><h2>Самые важные действия по машине</h2></div><Bot size={22} /></div>
              <div className="feature-list">
                <div className="feature"><CircleAlert size={18} /><div><strong>Что требует внимания</strong><p>Сначала закройте критичные детали и высокоприоритетные работы по обслуживанию.</p></div></div>
                <div className="feature"><PackageSearch size={18} /><div><strong>Что заказать</strong><p>Для каждой детали видно OEM, производителя, цену и предложения поставщиков.</p></div></div>
                <div className="feature"><Wrench size={18} /><div><strong>Кто обслуживал</strong><p>История работ показывает, какие действия подтверждены сервисом и подходят для продажи машины.</p></div></div>
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Состояние машины</p><h2>Ключевые показатели</h2></div><Gauge size={22} /></div>
              <div className="metric-stack">
                <div><span>Стоимость каталога</span><strong>{formatMoney(totalPartsValue)}</strong></div>
                <div><span>Подтвержденные работы</span><strong>{state.records.filter((record) => record.verified).length}</strong></div>
                <div><span>Предложений по деталям</span><strong>{state.offers.length}</strong></div>
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Первый запуск</p><h2>{hasCloudProfile ? 'Редактирование профиля владельца' : 'Onboarding владельца'}</h2></div><CarFront size={22} /></div>
              <div className="cloud-card">
                <div className="assistant-input"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="имя владельца" /></div>
                <div className="assistant-input"><input value={state.vehicle.brand} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, brand: event.target.value } }))} placeholder="марка" /></div>
                <div className="assistant-input"><input value={state.vehicle.model} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, model: event.target.value } }))} placeholder="модель" /></div>
                <div className="assistant-input"><input value={String(state.vehicle.year)} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, year: Number.parseInt(event.target.value, 10) || current.vehicle.year } }))} placeholder="год" /></div>
                <div className="assistant-input"><input value={state.vehicle.vin} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, vin: event.target.value.toUpperCase() } }))} placeholder="VIN" /></div>
                <div className="assistant-input"><input value={state.vehicle.plate} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, plate: event.target.value } }))} placeholder="номер" /></div>
                <div className="assistant-input"><input value={String(state.vehicle.mileageKm)} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, mileageKm: Number.parseInt(event.target.value, 10) || 0 } }))} placeholder="пробег, км" /></div>
                <div className="assistant-input"><input value={state.vehicle.engine} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, engine: event.target.value } }))} placeholder="двигатель" /></div>
                <div className="assistant-input"><input value={state.vehicle.nextInspection} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, nextInspection: event.target.value } }))} placeholder="следующий осмотр, YYYY-MM-DD" /></div>
                <div className="hero-actions">
                  <button className="primary-button" onClick={handleSaveCloudProfile} disabled={!session}>Сохранить профиль в облако</button>
                </div>
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Облачный этап</p><h2>Supabase readiness</h2></div><Cog size={22} /></div>
              <div className="cloud-card">
                <p className="muted">{syncStatus}</p>
                <div className="detail-list">
                  <div><span>Cloud</span><strong>{isSupabaseEnabled ? 'Настроен' : 'Не настроен'}</strong></div>
                  <div><span>Пользователь</span><strong>{session?.user.email ?? 'Локальный режим'}</strong></div>
                </div>
                <p className="muted">Google-вход быстрее для тестеров, а email оставлен как резервный способ. Redirect берется из текущего домена, поэтому потом подойдет и Cloudflare.</p>
                <div className="assistant-input"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="имя профиля" /></div>
                <div className="assistant-input"><input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="email для входа по magic link" /></div>
                <div className="hero-actions">
                  <button className="primary-button" onClick={handleGoogleLogin} disabled={!isSupabaseEnabled}>Войти через Google</button>
                  <button className="ghost-button" onClick={handleCloudLogin} disabled={!isSupabaseEnabled}>Войти по email</button>
                  <button className="ghost-button" onClick={handleCloudRefresh} disabled={!isSupabaseEnabled}>Обновить</button>
                  <button className="ghost-button" onClick={handleCreateCloudGarage} disabled={!session}>Создать профиль и авто</button>
                  <button className="ghost-button" onClick={handleCloudLogout} disabled={!session}>Выйти</button>
                </div>
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Роли сервиса</p><h2>Что появилось в продукте</h2></div><Users size={22} /></div>
              <ul className="stack-list">
                <li>Механик может создать аккаунт без машины и работать только с задачами и записями.</li>
                <li>Механик подтверждается только админом СТО.</li>
                <li>Админ СТО управляет персоналом, очередью, настройками и деактивацией сотрудников.</li>
                <li>Владелец остается в отдельном автомобильном сценарии и не видит внутреннюю кухню сервиса.</li>
              </ul>
            </article>
          </section>
        )}
        {state.role === 'owner' && activeTab === 'parts' && (
          <section className="grid">
            {state.parts.map((part: Part) => (
              <article className="panel" key={part.id}>
                <div className="panel-heading"><div><p className="eyebrow">{part.manufacturer}</p><h2>{part.name}</h2></div><span className={`status-chip ${part.status}`}>{part.status}</span></div>
                <div className="detail-list"><div><span>OEM</span><strong>{part.oem}</strong></div><div><span>Цена</span><strong>{formatMoney(part.price)}</strong></div></div>
                <p className="muted">{part.note}</p>
              </article>
            ))}
          </section>
        )}
        {state.role === 'owner' && activeTab === 'maintenance' && (
          <section className="grid">
            {state.maintenance.map((task) => (
              <article className="panel" key={task.id}>
                <div className="panel-heading"><div><p className="eyebrow">{priorityLabels[task.priority]}</p><h2>{task.title}</h2></div><Activity size={22} /></div>
                <div className="progress-track"><div className="progress-bar" style={{ width: `${getMaintenanceProgress(task, state.vehicle.mileageKm)}%` }} /></div>
                <div className="detail-list"><div><span>Следующая отметка</span><strong>{task.dueAtKm.toLocaleString('ru-RU')} км</strong></div><div><span>Последнее ТО</span><strong>{task.lastDoneKm.toLocaleString('ru-RU')} км</strong></div></div>
                <p className="muted">{task.notes}</p>
                <button className="ghost-button compact" onClick={() => markTaskDone(task.id)}>Отметить выполненным</button>
              </article>
            ))}
          </section>
        )}
        {state.role === 'owner' && activeTab === 'history' && (
          <section className="grid">
            <article className="panel panel-wide">
              <div className="panel-heading"><div><p className="eyebrow">История обслуживания</p><h2>Прозрачность для владельца и покупателя</h2></div><BadgeCheck size={22} /></div>
              <div className="timeline">
                {state.records.map((record: ServiceRecord) => (
                  <div className="timeline-item" key={record.id}>
                    <div><strong>{record.title}</strong><p>{record.date} • {record.location} • {record.mechanic}</p><p className="muted">{record.details}</p></div>
                    <button className={`verify-button ${record.verified ? 'is-verified' : ''}`} onClick={() => toggleServiceRecord(record.id)}>{record.verified ? 'Подтверждено' : 'Проверить'}</button>
                  </div>
                ))}
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">ДТП и кузов</p><h2>История событий</h2></div><ShieldCheck size={22} /></div>
              <div className="timeline compact-timeline">
                {state.accidents.map((accident: AccidentRecord) => (
                  <div className="timeline-item" key={accident.id}><div><strong>{accident.title}</strong><p>{accident.date} • {accident.severity}</p><p className="muted">{accident.details}</p></div></div>
                ))}
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Документы</p><h2>Страховка, диагностика и заказ-наряды</h2></div><BadgeCheck size={22} /></div>
              <div className="timeline compact-timeline">
                {state.documents.map((document: DocumentRecord) => (
                  <div className="timeline-item" key={document.id}><div><strong>{document.title}</strong><p>{document.issuedAt}{document.expiresAt ? ` • до ${document.expiresAt}` : ''}</p><p className="muted">{document.verified ? 'Проверенный документ' : 'Ждет подтверждения'} • {document.category}</p></div></div>
                ))}
              </div>
            </article>
          </section>
        )}
        {state.role === 'owner' && activeTab === 'assistant' && (
          <section className="grid" ref={assistantRef}>
            <article className="panel panel-wide assistant-panel">
              <div className="panel-heading"><div><p className="eyebrow">ИИ-помощник</p><h2>Быстрые ответы по машине</h2></div><Sparkles size={22} /></div>
              <div className="assistant-log">{assistantLog.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}</div>
              <div className="assistant-input"><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Например: когда менять масло или какой OEM у датчика?" /><button className="primary-button" onClick={submitAssistantPrompt}>Отправить</button></div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Подсказки сейчас</p><h2>Что приложение уже может подсветить</h2></div><PackageSearch size={22} /></div>
              <div className="timeline compact-timeline">
                {expiringDocuments.map((document: DocumentRecord) => <div className="timeline-item" key={document.id}><div><strong>{document.title}</strong><p>Скоро потребуется обновление: {document.expiresAt}</p></div></div>)}
                {recommendedOffers.map((offer: MarketplaceOffer) => { const part = state.parts.find((item) => item.id === offer.partId); return <div className="timeline-item" key={offer.id}><div><strong>{part?.name ?? 'Деталь'}</strong><p>{offer.seller} • {formatMoney(offer.price)} • доставка {offer.etaDays} дн.</p></div></div>; })}
              </div>
            </article>
          </section>
        )}
        {state.role === 'mechanic' && activeTab === 'overview' && (
          <section className="grid">
            <article className="panel panel-wide">
              <div className="panel-heading"><div><p className="eyebrow">Мои задачи</p><h2>Автомобили и работы на сегодня</h2></div><ListTodo size={22} /></div>
              <div className="timeline">
                {state.mechanicTasks.map((task) => (
                  <div className="timeline-item" key={task.id}>
                    <div><strong>{task.title}</strong><p>{task.carLabel} • {task.ownerName} • {task.scheduledAt}</p><p className="muted">{task.bay} • {priorityLabels[task.priority]} • {task.status}</p></div>
                    <button className="ghost-button compact" onClick={() => markTaskDone(task.id)}>Закрыть задачу</button>
                  </div>
                ))}
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Статус аккаунта</p><h2>Доступ механика</h2></div><ShieldAlert size={22} /></div>
              <ul className="stack-list">
                <li>Механик может создать аккаунт сам.</li>
                <li>До подтверждения админом СТО записи не считаются доверенными.</li>
                <li>После деактивации доступ к рабочему кабинету блокируется.</li>
              </ul>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Облако</p><h2>Регистрация механика</h2></div><Cog size={22} /></div>
              <div className="cloud-card">
                <p className="muted">{syncStatus}</p>
                <p className="muted">Для механика быстрый вход тоже идет через Google. После регистрации аккаунт останется в статусе ожидания до подтверждения админом СТО.</p>
                <div className="assistant-input"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="имя механика" /></div>
                <div className="assistant-input"><input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="email для magic link" /></div>
                <div className="hero-actions">
                  <button className="primary-button" onClick={handleGoogleLogin} disabled={!isSupabaseEnabled}>Google</button>
                  <button className="ghost-button" onClick={handleCloudLogin} disabled={!isSupabaseEnabled}>Email</button>
                  <button className="ghost-button" onClick={handleCreateCloudGarage} disabled={!session}>Создать аккаунт</button>
                </div>
              </div>
            </article>
          </section>
        )}
        {state.role === 'mechanic' && activeTab === 'history' && (
          <section className="grid">
            <article className="panel panel-wide">
              <div className="panel-heading"><div><p className="eyebrow">Недавние работы</p><h2>Что было сделано недавно</h2></div><CheckCheck size={22} /></div>
              <div className="timeline">
                {state.recentJobs.map((job) => (
                  <div className="timeline-item" key={job.id}><div><strong>{job.title}</strong><p>{job.carLabel} • {job.finishedAt}</p><p className="muted">{job.verified ? 'Подтверждено' : 'Ждет подтверждения'}</p></div></div>
                ))}
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Мои метрики</p><h2>Рабочая смена</h2></div><Gauge size={22} /></div>
              <div className="metric-stack">
                <div><span>Закрытых работ</span><strong>{state.recentJobs.length}</strong></div>
                <div><span>Активных задач</span><strong>{activeTasks.length}</strong></div>
                <div><span>Подтверждено</span><strong>{state.recentJobs.filter((job) => job.verified).length}</strong></div>
              </div>
            </article>
          </section>
        )}
        {state.role === 'mechanic' && activeTab === 'maintenance' && (
          <section className="grid">
            {state.serviceQueue.map((item) => (
              <article className="panel" key={item.id}>
                <div className="panel-heading"><div><p className="eyebrow">{item.status}</p><h2>{item.workType}</h2></div><CalendarClock size={22} /></div>
                <div className="detail-list"><div><span>Клиент</span><strong>{item.customer}</strong></div><div><span>Автомобиль</span><strong>{item.carLabel}</strong></div></div>
                <p className="muted">{item.scheduledAt}</p>
              </article>
            ))}
          </section>
        )}
        {state.role === 'mechanic' && activeTab === 'assistant' && (
          <section className="grid" ref={assistantRef}>
            <article className="panel panel-wide assistant-panel">
              <div className="panel-heading"><div><p className="eyebrow">Рабочие заметки</p><h2>Быстрый журнал механика</h2></div><Sparkles size={22} /></div>
              <div className="assistant-log">{assistantLog.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}</div>
              <div className="assistant-input"><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Например: какие работы у меня сегодня?" /><button className="primary-button" onClick={submitAssistantPrompt}>Сохранить</button></div>
            </article>
          </section>
        )}
        {(state.role === 'service_admin' || state.role === 'company_admin') && activeTab === 'overview' && (
          <section className="grid">
            <article className="panel panel-wide">
              <div className="panel-heading"><div><p className="eyebrow">{state.role === 'company_admin' ? 'Управление компанией' : 'Менеджмент СТО'}</p><h2>{state.role === 'company_admin' ? 'Контроль ролей, доступов и операционной дисциплины' : 'Персонал, подтверждения и контроль доступа'}</h2></div><Users size={22} /></div>
              <div className="timeline">
                {state.staff.map((member) => (
                  <div className="timeline-item" key={member.id}>
                    <div><strong>{member.name}</strong><p>{member.role} • {member.specialization}</p><p className="muted">{member.shift} • {member.approvalStatus}</p></div>
                    <div className="hero-actions">
                      {member.role === 'mechanic' && member.approvalStatus !== 'approved' && <button className="ghost-button compact" onClick={() => approveStaffMember(member.id)}>Подтвердить</button>}
                      {member.role === 'mechanic' && member.approvalStatus !== 'inactive' && <button className="ghost-button compact" onClick={() => deactivateStaffMember(member.id)}>Деактивировать</button>}
                    </div>
                  </div>
                ))}
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Показатели СТО</p><h2>Сервис сегодня</h2></div><Gauge size={22} /></div>
              <div className="metric-stack">
                <div><span>Активных заказов</span><strong>{state.serviceCenter.activeOrders}</strong></div>
                <div><span>Очередь</span><strong>{state.serviceCenter.queueDepth}</strong></div>
                <div><span>Ожидают подтверждения</span><strong>{pendingMechanics.length}</strong></div>
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Настройки роли</p><h2>Что должен уметь админ СТО</h2></div><Cog size={22} /></div>
              <ul className="stack-list">
                <li>{state.role === 'company_admin' ? 'Подтверждать админов СТО, механиков и отзывать доступы.' : 'Подтверждать механиков и деактивировать их доступ.'}</li>
                <li>Управлять очередью, постами, временем записи и загрузкой смен.</li>
                <li>Настраивать карточку СТО, команду и сервисные процессы.</li>
                <li>Следить, чтобы только подтвержденные механики вносили доверенные записи.</li>
              </ul>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Onboarding</p><h2>{hasCloudProfile ? 'Редактирование профиля сервиса' : 'Первичная настройка сервиса'}</h2></div><Users size={22} /></div>
              <div className="cloud-card">
                <div className="assistant-input"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder={state.role === 'company_admin' ? 'имя администратора компании' : 'имя админа СТО'} /></div>
                <div className="assistant-input"><input value={serviceCenterName} onChange={(event) => setServiceCenterName(event.target.value)} placeholder="название СТО" /></div>
                <div className="assistant-input"><input value={serviceCenterCity} onChange={(event) => setServiceCenterCity(event.target.value)} placeholder="город СТО" /></div>
                <div className="assistant-input"><input value={serviceCenterBays} onChange={(event) => setServiceCenterBays(event.target.value)} placeholder="количество постов" /></div>
                <div className="hero-actions">
                  <button className="primary-button" onClick={handleSaveCloudProfile} disabled={!session}>Сохранить профиль в облако</button>
                </div>
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Облако</p><h2>{state.role === 'company_admin' ? 'Регистрация администратора компании' : 'Регистрация админа СТО'}</h2></div><Cog size={22} /></div>
              <div className="cloud-card">
                <p className="muted">{syncStatus}</p>
                <div className="assistant-input"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder={state.role === 'company_admin' ? 'имя администратора компании' : 'имя админа СТО'} /></div>
                <div className="assistant-input"><input value={serviceCenterName} onChange={(event) => setServiceCenterName(event.target.value)} placeholder="название СТО" /></div>
                <div className="assistant-input"><input value={serviceCenterCity} onChange={(event) => setServiceCenterCity(event.target.value)} placeholder="город СТО" /></div>
                <div className="assistant-input"><input value={serviceCenterBays} onChange={(event) => setServiceCenterBays(event.target.value)} placeholder="количество постов" /></div>
                <div className="assistant-input"><input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="email для запасного входа по magic link" /></div>
                <div className="hero-actions">
                  <button className="primary-button" onClick={handleGoogleLogin} disabled={!isSupabaseEnabled}>Google</button>
                  <button className="ghost-button" onClick={handleCloudLogin} disabled={!isSupabaseEnabled}>Email</button>
                  <button className="ghost-button" onClick={handleCreateCloudGarage} disabled={!session}>Создать профиль</button>
                </div>
              </div>
            </article>
          </section>
        )}
        {(state.role === 'service_admin' || state.role === 'company_admin') && activeTab === 'history' && (
          <section className="grid">
            <article className="panel panel-wide">
              <div className="panel-heading"><div><p className="eyebrow">{state.role === 'company_admin' ? 'Последние работы по компании' : 'Последние работы по СТО'}</p><h2>Контроль качества и прозрачности</h2></div><BadgeCheck size={22} /></div>
              <div className="timeline">
                {state.records.map((record) => (
                  <div className="timeline-item" key={record.id}>
                    <div><strong>{record.title}</strong><p>{record.location} • {record.mechanic}</p><p className="muted">{record.date} • {record.details}</p></div>
                    <button className={`verify-button ${record.verified ? 'is-verified' : ''}`} onClick={() => toggleServiceRecord(record.id)}>{record.verified ? 'Подтверждено' : 'Проверить'}</button>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}
        {(state.role === 'service_admin' || state.role === 'company_admin') && activeTab === 'maintenance' && (
          <section className="grid">
            {state.serviceQueue.map((item) => (
              <article className="panel" key={item.id}>
                <div className="panel-heading"><div><p className="eyebrow">{item.status}</p><h2>{item.workType}</h2></div><CalendarClock size={22} /></div>
                <div className="detail-list"><div><span>Клиент</span><strong>{item.customer}</strong></div><div><span>Автомобиль</span><strong>{item.carLabel}</strong></div></div>
                <p className="muted">{item.scheduledAt}</p>
              </article>
            ))}
          </section>
        )}
        {(state.role === 'service_admin' || state.role === 'company_admin') && activeTab === 'assistant' && (
          <section className="grid" ref={assistantRef}>
            <article className="panel panel-wide assistant-panel">
              <div className="panel-heading"><div><p className="eyebrow">{state.role === 'company_admin' ? 'Корпоративные заметки' : 'Менеджерские заметки'}</p><h2>{state.role === 'company_admin' ? 'Быстрый журнал администратора компании' : 'Быстрый журнал админа СТО'}</h2></div><Sparkles size={22} /></div>
              <div className="assistant-log">{assistantLog.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}</div>
              <div className="assistant-input"><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Например: сколько механиков ждут подтверждения?" /><button className="primary-button" onClick={submitAssistantPrompt}>Сохранить</button></div>
            </article>
          </section>
        )}
      </main>

      <nav className="tabs tabs-bottom">
        {tabs.map((tab) => (
          <button key={tab.key} className={activeTab === tab.key ? 'active' : ''} onClick={() => openTab(tab.key as TabKey)}>{tab.label}</button>
        ))}
      </nav>
    </div>
  );
}

export default App;
