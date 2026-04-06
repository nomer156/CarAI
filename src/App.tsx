import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  CarFront, Check, ChevronDown, ChevronUp, Cog, LogIn, Moon, Plus,
  Sparkles, SunMedium, Trash2, Users, Wrench,
} from 'lucide-react';
import { availableCarColors, carCatalog } from './data/carCatalog';
import { demoState } from './data/demoData';
import {
  bootstrapDemoGarage, bootstrapStaffAccount, deleteCloudAccountData, getCurrentSession,
  isSupabaseEnabled, loadGarageStateFromCloud, saveOwnerProfile, saveStaffProfile,
  signInWithGoogle, signOutCloud, subscribeToAuthChanges,
} from './lib/cloud';
import { clearGarageState, loadGarageState, saveGarageState } from './lib/db';
import type { GarageState, MaintenanceTask, Part, StaffMember, UserRole } from './types';

type TabKey = 'overview' | 'parts' | 'maintenance' | 'history' | 'assistant';
type ThemeMode = 'light' | 'dark';
type StaffRoleOption = 'mechanic' | 'staff' | 'service_admin';

const ownerTabs = ['overview', 'parts', 'maintenance', 'history', 'assistant'] as const;
const mechanicTabs = ['overview', 'parts', 'maintenance', 'history', 'assistant'] as const;
const adminTabs = ['overview', 'maintenance', 'history', 'assistant'] as const;
const tabLabels: Record<TabKey, string> = {
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

function App() {
  const [state, setState] = useState<GarageState>(demoState);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = window.localStorage.getItem('codexcar-theme');
    return saved === 'dark' || saved === 'light' ? saved : 'light';
  });
  const [session, setSession] = useState<Session | null>(null);
  const [syncStatus, setSyncStatus] = useState(isSupabaseEnabled ? 'Готово к входу через Google.' : 'Демо-режим');
  const [hasCloudProfile, setHasCloudProfile] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPassportExpanded, setIsPassportExpanded] = useState(false);
  const [expandedMaintenanceId, setExpandedMaintenanceId] = useState<string | null>('to-1');
  const [quickCommand, setQuickCommand] = useState('');
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLog, setAssistantLog] = useState<string[]>(['Помощник готов к быстрым командам.']);
  const [profileName, setProfileName] = useState('Алексей Ковалев');
  const [serviceCenterName, setServiceCenterName] = useState('Nord Garage');
  const [serviceCenterCity, setServiceCenterCity] = useState('Москва');
  const [serviceCenterBays, setServiceCenterBays] = useState('6');
  const [ownerPartDraft, setOwnerPartDraft] = useState({ name: '', oem: '', manufacturer: '', price: '', note: '' });
  const [servicePartDraft, setServicePartDraft] = useState({ name: '', oem: '', manufacturer: '', price: '', note: '' });
  const [employeeDraft, setEmployeeDraft] = useState({ name: '', role: 'mechanic' as StaffRoleOption, specialization: '', shift: '09:00 - 18:00' });
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
      setServiceCenterName(state.serviceCenter.name);
      setServiceCenterCity(state.serviceCenter.city);
      setServiceCenterBays(String(state.serviceCenter.bays));
    }
  }, [state]);
  useEffect(() => { saveGarageState(state).catch(() => undefined); }, [state]);
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    getCurrentSession().then(async (next) => {
      setSession(next);
      if (!next) return;
      const cloudState = await loadGarageStateFromCloud();
      if (cloudState) { setState(cloudState); setHasCloudProfile(true); setSyncStatus('Профиль загружен из облака.'); }
    }).catch((error: Error) => setSyncStatus(error.message));
    return subscribeToAuthChanges((next) => {
      setSession(next);
      if (!next?.user?.email) { setHasCloudProfile(false); setSyncStatus('Вы не вошли.'); return; }
      setSyncStatus(`Вы вошли как ${next.user.email}.`);
      void loadGarageStateFromCloud().then((cloudState) => {
        if (cloudState) { setState(cloudState); setHasCloudProfile(true); }
      }).catch(() => undefined);
    });
  }, []);

  const roleLabel = state.role === 'owner' ? 'Владелец' : state.role === 'mechanic' ? 'Механик' : state.role === 'service_admin' ? 'Админ СТО' : 'Администратор компании';
  const brandKey = state.vehicle.brand.toLowerCase().includes('bmw') ? 'bmw' : state.vehicle.brand.toLowerCase().includes('mercedes') ? 'mercedes' : state.vehicle.brand.toLowerCase().includes('toyota') ? 'toyota' : 'default';
  const carVisual = carCatalog[brandKey] ?? carCatalog.default;
  const tabs = state.role === 'owner' ? ownerTabs : state.role === 'mechanic' ? mechanicTabs : adminTabs;

  function switchRole(role: UserRole) {
    setState((current) => ({ ...current, role, approvalStatus: role === 'mechanic' ? 'pending' : 'approved' }));
    setActiveTab('overview');
    setIsSettingsOpen(false);
  }

  function addPart(source: 'self' | 'service') {
    const draft = source === 'self' ? ownerPartDraft : servicePartDraft;
    if (!draft.name.trim() || !draft.oem.trim()) return;
    const next: Part = { id: `part-${Date.now()}`, name: draft.name, oem: draft.oem, manufacturer: draft.manufacturer || 'Не указан', price: Number.parseInt(draft.price, 10) || 0, status: 'ok', note: draft.note || '', installationSource: source };
    setState((current) => ({ ...current, parts: [next, ...current.parts] }));
    source === 'self' ? setOwnerPartDraft({ name: '', oem: '', manufacturer: '', price: '', note: '' }) : setServicePartDraft({ name: '', oem: '', manufacturer: '', price: '', note: '' });
  }

  function addEmployee() {
    if (!employeeDraft.name.trim()) return;
    const next: StaffMember = { id: `staff-${Date.now()}`, name: employeeDraft.name, role: employeeDraft.role, approvalStatus: employeeDraft.role === 'mechanic' ? 'pending' : 'approved', specialization: employeeDraft.specialization || 'Сотрудник сервиса', shift: employeeDraft.shift };
    setState((current) => ({ ...current, staff: [next, ...current.staff] }));
    setEmployeeDraft({ name: '', role: 'mechanic', specialization: '', shift: '09:00 - 18:00' });
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

  async function signIn() { try { setSyncStatus('Переходим на вход через Google...'); await signInWithGoogle(); } catch (error) { setSyncStatus(error instanceof Error ? error.message : 'Ошибка входа.'); } }
  async function logout() { try { await signOutCloud(); setSession(null); setHasCloudProfile(false); setSyncStatus('Вы вышли.'); } catch (error) { setSyncStatus(error instanceof Error ? error.message : 'Ошибка выхода.'); } }
  async function refreshCloud() { if (!session) return; const cloudState = await loadGarageStateFromCloud(); if (cloudState) { setState(cloudState); setHasCloudProfile(true); setSyncStatus('Данные обновлены.'); } }
  async function createCloudProfile() {
    if (!session) return;
    if (state.role === 'owner' || state.role === 'mechanic') await bootstrapDemoGarage(profileName.trim(), state.role === 'owner' ? 'owner' : 'mechanic');
    else await bootstrapStaffAccount(profileName.trim(), state.role, serviceCenterName.trim(), serviceCenterCity.trim());
    await refreshCloud();
  }
  async function saveCloudProfile() {
    if (!session) return;
    if (state.role === 'owner') await saveOwnerProfile({ profileName, brand: state.vehicle.brand, model: state.vehicle.model, year: state.vehicle.year, vin: state.vehicle.vin, plate: state.vehicle.plate, mileageKm: state.vehicle.mileageKm, engine: state.vehicle.engine, color: state.vehicle.color, nextInspection: state.vehicle.nextInspection });
    if (state.role === 'service_admin' || state.role === 'company_admin') await saveStaffProfile({ profileName, role: state.role, serviceCenterName, serviceCenterCity, serviceCenterBays: Number.parseInt(serviceCenterBays, 10) || 1 });
    await refreshCloud();
  }
  async function deleteAccount() {
    if (!window.confirm('Удалить данные аккаунта и начать сначала?')) return;
    if (session) { await deleteCloudAccountData(); await signOutCloud(); }
    await clearGarageState();
    setState(demoState);
    setSession(null);
    setHasCloudProfile(false);
    setSyncStatus('Данные удалены.');
  }

  function renderPartCard(part: Part) {
    const sourceLabel = part.installationSource === 'self' ? 'Менял сам' : 'Сделано сертифицированным СТО';
    const sourceClass = part.installationSource === 'self' ? 'self' : 'service';
    return <article className="part-card" key={part.id}><div className="panel-heading"><div><strong>{part.name}</strong><p className="muted">{part.manufacturer}</p></div><span className={`status-chip ${part.status}`}>{part.status}</span></div><div className="detail-list"><div><span>OEM</span><strong>{part.oem}</strong></div><div><span>Цена</span><strong>{formatMoney(part.price)}</strong></div></div><span className={`source-badge ${sourceClass}`}><Check size={14} />{sourceLabel}</span><p className="muted">{part.note}</p></article>;
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand-lockup"><p className="eyebrow">CodexCar</p><strong>{roleLabel}</strong></div>
        <div className="auth-strip">
          <span className={`pill ${session ? 'approved' : 'pending'}`}>{session?.user?.email ?? 'Не вошли'}</span>
          {session ? <button className="ghost-button compact" onClick={logout}>Выйти</button> : <button className="primary-button compact" onClick={signIn} disabled={!isSupabaseEnabled}><LogIn size={16} />Войти / регистрация</button>}
          <button className="theme-toggle" onClick={() => setIsSettingsOpen((current) => !current)}><Cog size={18} /></button>
          <button className="theme-toggle" onClick={() => setThemeMode((current) => current === 'light' ? 'dark' : 'light')}>{themeMode === 'light' ? <Moon size={18} /> : <SunMedium size={18} />}</button>
        </div>
      </div>

      {isSettingsOpen && <section className="settings-panel"><div className="panel-heading"><div><h2>Настройки</h2><p className="muted">Тема, демо-роли, цвет машины и сброс данных.</p></div><Cog size={22} /></div><div className="settings-grid"><div><span className="settings-label">Режим</span><div className="segmented"><button className={state.role === 'owner' ? 'active' : ''} onClick={() => switchRole('owner')}>Владелец</button><button className={state.role === 'mechanic' ? 'active' : ''} onClick={() => switchRole('mechanic')}>Механик</button><button className={state.role === 'service_admin' ? 'active' : ''} onClick={() => switchRole('service_admin')}>Админ СТО</button><button className={state.role === 'company_admin' ? 'active' : ''} onClick={() => switchRole('company_admin')}>Админ компании</button></div></div><div><span className="settings-label">Цвет машины</span><div className="color-picker">{availableCarColors.map((color) => <button key={color} className={state.vehicle.color === color ? 'color-swatch active' : 'color-swatch'} onClick={() => setState((current) => ({ ...current, vehicle: { ...current.vehicle, color } }))}>{color}</button>)}</div></div></div><div className="settings-footer"><button className="danger-button" onClick={deleteAccount}><Trash2 size={16} />Удалить аккаунт и данные</button></div></section>}

      <section className="quick-command"><div className="quick-command-copy"><h2>Быстрое действие</h2><p className="muted">Например: `поменял сегодня масло 5W40`.</p></div><div className="assistant-input quick-command-input"><input value={quickCommand} onChange={(event) => setQuickCommand(event.target.value)} placeholder="Что произошло?" /><button className="primary-button" onClick={applyQuickCommand}>Выполнить</button></div></section>

      <header className="hero-card">
        <div className="hero-copy"><h1>{state.role === 'owner' ? 'Машина и обслуживание в одном месте' : state.role === 'mechanic' ? 'Работы и детали в одном кабинете' : 'Команда и сервис без лишнего шума'}</h1><p className="hero-text">{syncStatus}</p><div className="hero-actions"><button className="primary-button" onClick={() => assistantRef.current?.scrollIntoView({ behavior: 'smooth' })}><Sparkles size={18} />Открыть помощника</button><button className="ghost-button" onClick={refreshCloud} disabled={!session}>Обновить</button></div></div>
        <div className="hero-panel">{state.role === 'owner' ? <div className="vehicle-card hero-passport"><button className="passport-toggle" onClick={() => setIsPassportExpanded((current) => !current)}><div className="passport-collapsed"><div className="passport-visual" style={{ backgroundColor: carVisual.accent }}><img src={carVisual.image} alt={`${state.vehicle.brand} showcase`} /></div><div><strong>{state.vehicle.brand} {state.vehicle.model}</strong><p>{state.vehicle.plate}</p></div></div>{isPassportExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>{isPassportExpanded && <div className="vehicle-grid passport-details"><div><span>Год</span><strong>{state.vehicle.year}</strong></div><div><span>VIN</span><strong>{state.vehicle.vin}</strong></div><div><span>Пробег</span><strong>{state.vehicle.mileageKm.toLocaleString('ru-RU')} км</strong></div><div><span>Двигатель</span><strong>{state.vehicle.engine}</strong></div><div><span>Цвет</span><strong>{state.vehicle.color}</strong></div><div><span>Осмотр</span><strong>{state.vehicle.nextInspection}</strong></div></div>}</div> : <div className="vehicle-card"><div className="vehicle-title">{state.role === 'mechanic' ? <Wrench size={20} /> : <Users size={20} />}<strong>{state.serviceCenter.name}</strong></div><p>{state.serviceCenter.city}</p><div className="vehicle-grid"><div><span>Постов</span><strong>{state.serviceCenter.bays}</strong></div><div><span>Ожидают механика</span><strong>{state.staff.filter((item) => item.role === 'mechanic' && item.approvalStatus === 'pending').length}</strong></div></div></div>}</div>
      </header>

      <nav className="tabs tabs-top">{tabs.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tabLabels[tab]}</button>)}</nav>

      <main className="dashboard">
        {state.role === 'owner' && activeTab === 'overview' && <section className="grid"><article className="panel"><div className="panel-heading"><div><h2>{hasCloudProfile ? 'Профиль владельца' : 'Создать профиль'}</h2><p className="muted">Базовая настройка машины и профиля.</p></div><CarFront size={22} /></div><div className="cloud-card"><div className="assistant-input"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Имя владельца" /></div><div className="assistant-input"><input value={state.vehicle.brand} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, brand: event.target.value } }))} placeholder="Марка" /></div><div className="assistant-input"><input value={state.vehicle.model} onChange={(event) => setState((current) => ({ ...current, vehicle: { ...current.vehicle, model: event.target.value } }))} placeholder="Модель" /></div><div className="hero-actions"><button className="primary-button" onClick={saveCloudProfile} disabled={!session}>Сохранить</button><button className="ghost-button" onClick={createCloudProfile} disabled={!session || hasCloudProfile}>Создать</button></div></div></article></section>}
        {state.role === 'owner' && activeTab === 'parts' && <section className="grid"><article className="panel panel-wide"><div className="parts-grid">{state.parts.map(renderPartCard)}</div></article><article className="panel"><div className="panel-heading"><div><h2>Добавить деталь</h2><p className="muted">Получит желтую галочку: менял сам.</p></div><Plus size={20} /></div><div className="cloud-card"><div className="assistant-input"><input value={ownerPartDraft.name} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Название" /></div><div className="assistant-input"><input value={ownerPartDraft.oem} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, oem: event.target.value }))} placeholder="OEM" /></div><div className="assistant-input"><input value={ownerPartDraft.manufacturer} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Производитель" /></div><div className="assistant-input"><input value={ownerPartDraft.price} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Цена" /></div><div className="assistant-input"><input value={ownerPartDraft.note} onChange={(event) => setOwnerPartDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Заметка" /></div><button className="primary-button" onClick={() => addPart('self')}>Добавить</button></div></article></section>}
        {state.role === 'owner' && activeTab === 'maintenance' && <section className="grid"><article className="panel panel-wide maintenance-stack">{state.maintenance.map((task) => <article className="maintenance-card" key={task.id}><button className="maintenance-toggle" onClick={() => setExpandedMaintenanceId((current) => current === task.id ? null : task.id)}><div><strong>{task.title}</strong><p className="muted">{task.dueAtKm.toLocaleString('ru-RU')} км</p></div>{expandedMaintenanceId === task.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button><div className="progress-track"><div className="progress-bar" style={{ width: `${maintenanceProgress(task, state.vehicle.mileageKm)}%` }} /></div>{expandedMaintenanceId === task.id && <div className="maintenance-details"><ul className="stack-list">{task.items.map((item) => <li key={item}>{item}</li>)}</ul><p className="muted">{task.notes}</p></div>}</article>)}</article></section>}
        {state.role === 'owner' && activeTab === 'history' && <section className="grid"><article className="panel panel-wide"><div className="timeline">{state.records.map((record) => <div className="timeline-item" key={record.id}><div><strong>{record.title}</strong><p>{record.date} • {record.location} • {record.mechanic}</p><p className="muted">{record.details}</p></div><span className={`source-badge ${record.verified ? 'service' : 'neutral'}`}>{record.verified ? 'Подтверждено' : 'Черновик'}</span></div>)}</div></article></section>}
        {state.role === 'owner' && activeTab === 'assistant' && <section className="grid" ref={assistantRef}><article className="panel panel-wide assistant-panel"><div className="assistant-log">{assistantLog.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}</div><div className="assistant-input"><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Введите запрос" /><button className="primary-button" onClick={() => { if (!assistantInput.trim()) return; setAssistantLog((current) => [...current, `Вы: ${assistantInput}`, `AI: ${assistantReply(assistantInput, state)}`]); setAssistantInput(''); }}>Отправить</button></div></article></section>}

        {state.role === 'mechanic' && activeTab === 'overview' && <section className="grid"><article className="panel panel-wide"><div className="timeline">{state.mechanicTasks.map((task) => <div className="timeline-item" key={task.id}><div><strong>{task.title}</strong><p>{task.carLabel} • {task.ownerName}</p><p className="muted">{task.bay} • {task.scheduledAt}</p></div><button className="ghost-button compact" onClick={() => setState((current) => ({ ...current, mechanicTasks: current.mechanicTasks.map((item) => item.id === task.id ? { ...item, status: 'done' } : item) }))}>Готово</button></div>)}</div></article><article className="panel"><div className="cloud-card"><div className="assistant-input"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Имя механика" /></div><div className="hero-actions"><button className="primary-button" onClick={createCloudProfile} disabled={!session || hasCloudProfile}>Создать профиль</button></div></div></article></section>}
        {state.role === 'mechanic' && activeTab === 'parts' && <section className="grid"><article className="panel panel-wide"><div className="parts-grid">{state.parts.map(renderPartCard)}</div></article><article className="panel"><div className="panel-heading"><div><h2>Добавить деталь</h2><p className="muted">Будет отмечена зеленой галочкой как работа СТО.</p></div><Plus size={20} /></div><div className="cloud-card"><div className="assistant-input"><input value={servicePartDraft.name} onChange={(event) => setServicePartDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Название" /></div><div className="assistant-input"><input value={servicePartDraft.oem} onChange={(event) => setServicePartDraft((current) => ({ ...current, oem: event.target.value }))} placeholder="OEM" /></div><div className="assistant-input"><input value={servicePartDraft.manufacturer} onChange={(event) => setServicePartDraft((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Производитель" /></div><div className="assistant-input"><input value={servicePartDraft.price} onChange={(event) => setServicePartDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Цена" /></div><div className="assistant-input"><input value={servicePartDraft.note} onChange={(event) => setServicePartDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Заметка" /></div><button className="primary-button" onClick={() => addPart('service')}>Добавить</button></div></article></section>}
        {state.role === 'mechanic' && activeTab === 'maintenance' && <section className="grid">{state.serviceQueue.map((item) => <article className="panel" key={item.id}><strong>{item.workType}</strong><p>{item.customer} • {item.carLabel}</p><p className="muted">{item.scheduledAt}</p></article>)}</section>}
        {state.role === 'mechanic' && activeTab === 'history' && <section className="grid"><article className="panel panel-wide"><div className="timeline">{state.recentJobs.map((job) => <div className="timeline-item" key={job.id}><div><strong>{job.title}</strong><p>{job.carLabel}</p><p className="muted">{job.finishedAt}</p></div><span className={`source-badge ${job.verified ? 'service' : 'neutral'}`}>{job.verified ? 'Подтверждено' : 'Ждет подтверждения'}</span></div>)}</div></article></section>}
        {state.role === 'mechanic' && activeTab === 'assistant' && <section className="grid" ref={assistantRef}><article className="panel panel-wide assistant-panel"><div className="assistant-log">{assistantLog.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}</div><div className="assistant-input"><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Рабочая заметка" /><button className="primary-button" onClick={() => { if (!assistantInput.trim()) return; setAssistantLog((current) => [...current, `Вы: ${assistantInput}`, `AI: ${assistantReply(assistantInput, state)}`]); setAssistantInput(''); }}>Сохранить</button></div></article></section>}

        {(state.role === 'service_admin' || state.role === 'company_admin') && activeTab === 'overview' && <section className="grid"><article className="panel panel-wide"><div className="timeline">{state.staff.map((member) => <div className="timeline-item" key={member.id}><div><strong>{member.name}</strong><p>{member.role === 'mechanic' ? 'Механик' : 'Сотрудник'}</p><p className="muted">{member.specialization} • {member.shift}</p></div>{member.role === 'mechanic' ? <div className="hero-actions">{member.approvalStatus !== 'approved' && <button className="ghost-button compact" onClick={() => setState((current) => ({ ...current, staff: current.staff.map((item) => item.id === member.id ? { ...item, approvalStatus: 'approved' } : item) }))}>Подтвердить</button>}{member.approvalStatus !== 'inactive' && <button className="ghost-button compact" onClick={() => setState((current) => ({ ...current, staff: current.staff.map((item) => item.id === member.id ? { ...item, approvalStatus: 'inactive' } : item) }))}>Деактивировать</button>}</div> : <span className="source-badge neutral">Сотрудник</span>}</div>)}</div></article><article className="panel"><div className="cloud-card"><div className="assistant-input"><input value={employeeDraft.name} onChange={(event) => setEmployeeDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Имя сотрудника" /></div><div className="assistant-input"><input value={employeeDraft.role} onChange={(event) => setEmployeeDraft((current) => ({ ...current, role: event.target.value as StaffRoleOption }))} placeholder="mechanic / staff / service_admin" /></div><div className="assistant-input"><input value={employeeDraft.specialization} onChange={(event) => setEmployeeDraft((current) => ({ ...current, specialization: event.target.value }))} placeholder="Специализация" /></div><button className="primary-button" onClick={addEmployee}>Добавить сотрудника</button></div></article><article className="panel"><div className="cloud-card"><div className="assistant-input"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Имя администратора" /></div><div className="assistant-input"><input value={serviceCenterName} onChange={(event) => setServiceCenterName(event.target.value)} placeholder="Название СТО" /></div><div className="assistant-input"><input value={serviceCenterCity} onChange={(event) => setServiceCenterCity(event.target.value)} placeholder="Город" /></div><div className="assistant-input"><input value={serviceCenterBays} onChange={(event) => setServiceCenterBays(event.target.value)} placeholder="Количество постов" /></div><div className="hero-actions"><button className="primary-button" onClick={saveCloudProfile} disabled={!session}>Сохранить</button><button className="ghost-button" onClick={createCloudProfile} disabled={!session || hasCloudProfile}>Создать</button></div></div></article></section>}
        {(state.role === 'service_admin' || state.role === 'company_admin') && activeTab === 'maintenance' && <section className="grid">{state.serviceQueue.map((item) => <article className="panel" key={item.id}><strong>{item.workType}</strong><p>{item.customer} • {item.carLabel}</p><p className="muted">{item.scheduledAt}</p></article>)}</section>}
        {(state.role === 'service_admin' || state.role === 'company_admin') && activeTab === 'history' && <section className="grid"><article className="panel panel-wide"><div className="timeline">{state.records.map((record) => <div className="timeline-item" key={record.id}><div><strong>{record.title}</strong><p>{record.date} • {record.location}</p><p className="muted">{record.details}</p></div><button className={`verify-button ${record.verified ? 'is-verified' : ''}`}>{record.verified ? 'Подтверждено' : 'Проверить'}</button></div>)}</div></article></section>}
        {(state.role === 'service_admin' || state.role === 'company_admin') && activeTab === 'assistant' && <section className="grid" ref={assistantRef}><article className="panel panel-wide assistant-panel"><div className="assistant-log">{assistantLog.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}</div><div className="assistant-input"><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Заметка администратора" /><button className="primary-button" onClick={() => { if (!assistantInput.trim()) return; setAssistantLog((current) => [...current, `Вы: ${assistantInput}`, `AI: ${assistantReply(assistantInput, state)}`]); setAssistantInput(''); }}>Сохранить</button></div></article></section>}
      </main>

      <nav className="tabs tabs-bottom">{tabs.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tabLabels[tab]}</button>)}</nav>
    </div>
  );
}

export default App;
