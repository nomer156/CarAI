import type { GarageState, JournalRecord, MaintenanceTask, Part } from '../types';
import { resolveRecommendedOil } from '../data/carCatalog';

export type OwnerCommandIntent = 'replace_oil' | 'add_part' | 'update_mileage' | 'note_only';
export type RelativeDateMode = 'today' | 'yesterday' | 'specific' | 'unknown';

export type NormalizedOwnerCommand = {
  intent: OwnerCommandIntent;
  rawText: string;
  normalizedText?: string;
  confidence: number;
  dateMode: RelativeDateMode;
  specificDate?: string;
  mileageKm?: number;
  oilViscosity?: string;
  oilBrand?: string;
  partName?: string;
  manufacturer?: string;
  category?: string;
  cost?: number;
  nextMileage?: number;
  shouldCreatePart?: boolean;
};

type BuildPlanInput = {
  command: NormalizedOwnerCommand;
  state: GarageState;
  activeCarId: string;
  editingJournalId?: string | null;
};

export type OwnerExecutionPlan = {
  record: JournalRecord;
  partsToAdd: Part[];
  updatedVehicleMileageKm?: number;
  updateMaintenance?: boolean;
  feedback: string;
};

const OIL_PATTERN = /\b(\d{1,2}w[- ]?\d{2})\b/i;
const COST_PATTERN = /(?:за|на|стоимостью|стоило)\s+(\d[\d\s]{1,10})\s*(?:₽|руб|р)?/i;
const MILEAGE_PATTERNS = [
  /(?:пробег|на пробеге|при пробеге)\s*(\d{2,7})/i,
  /(?:на|при)\s*(\d{2,7})\s*(?:км|km)\b/i,
];

const SELF_PART_KEYWORDS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /салонн(?:ый|ого)\s+фильтр/i, name: 'Салонный фильтр' },
  { pattern: /воздушн(?:ый|ого)\s+фильтр/i, name: 'Воздушный фильтр' },
  { pattern: /маслян(?:ый|ого)|масляный\s+фильтр/i, name: 'Масляный фильтр' },
  { pattern: /колодк/i, name: 'Тормозные колодки' },
  { pattern: /диск(?:и|ов)?\s+тормоз/i, name: 'Тормозные диски' },
  { pattern: /свеч/i, name: 'Свечи' },
  { pattern: /амортиз/i, name: 'Амортизаторы' },
  { pattern: /аккумулятор/i, name: 'Аккумулятор' },
];

function normalizeOilViscosity(value?: string) {
  if (!value) return undefined;
  return value.toUpperCase().replace(/\s+/g, '').replace('-', 'W-').replace(/W$/, '');
}

function extractMileage(text: string) {
  for (const pattern of MILEAGE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return Number.parseInt(match[1], 10);
  }
  return undefined;
}

function extractCost(text: string) {
  const match = text.match(COST_PATTERN);
  if (!match) return undefined;
  return Number.parseInt(match[1].replace(/\s+/g, ''), 10) || undefined;
}

function detectDateMode(text: string): { dateMode: RelativeDateMode; specificDate?: string } {
  if (/сегодня/i.test(text)) return { dateMode: 'today' };
  if (/вчера/i.test(text)) return { dateMode: 'yesterday' };
  const match = text.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/);
  if (match) {
    const normalized = match[1].replace(/\./g, '-').replace(/\//g, '-');
    return { dateMode: 'specific', specificDate: normalized };
  }
  return { dateMode: 'unknown' };
}

function extractBrand(text: string) {
  const knownBrands = ['shell', 'liqui moly', 'mobil', 'castrol', 'motul', 'zic', 'total', 'elf', 'mann', 'mahle', 'trw', 'ate', 'bosch'];
  const normalized = text.toLowerCase();
  const match = knownBrands.find((brand) => normalized.includes(brand));
  if (!match) return undefined;
  return match.replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferPartName(text: string) {
  const match = SELF_PART_KEYWORDS.find((item) => item.pattern.test(text));
  return match?.name;
}

function resolveOccurredAt(command: NormalizedOwnerCommand) {
  const now = new Date();
  if (command.dateMode === 'yesterday') {
    const date = new Date(now);
    date.setDate(now.getDate() - 1);
    return date.getTime();
  }

  if (command.dateMode === 'specific' && command.specificDate) {
    const pieces = command.specificDate.split('-').map((value) => Number.parseInt(value, 10));
    if (pieces.length === 3 && pieces.every((value) => Number.isFinite(value))) {
      const [first, second, third] = pieces;
      const year = third < 100 ? 2000 + third : third;
      const dayFirst = first > 12;
      const date = new Date(year, (dayFirst ? second : first) - 1, dayFirst ? first : second);
      if (!Number.isNaN(date.getTime())) return date.getTime();
    }
  }

  return now.getTime();
}

function findPreviousOilRecord(state: GarageState, activeCarId: string) {
  return [...state.journal]
    .filter((record) => record.carId === activeCarId && /масл/i.test(record.note))
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

function findPrimaryMaintenanceTask(tasks: MaintenanceTask[]) {
  return tasks.find((task) => task.id === 'to-1') ?? tasks[0];
}

export function heuristicNormalizeOwnerCommand(input: {
  text: string;
  brand: string;
  model: string;
  currentMileageKm: number;
}): NormalizedOwnerCommand {
  const rawText = input.text.trim();
  const lowered = rawText.toLowerCase();
  const oilMatch = rawText.match(OIL_PATTERN);
  const { dateMode, specificDate } = detectDateMode(rawText);
  const mileageKm = extractMileage(rawText);
  const cost = extractCost(rawText);
  const manufacturer = extractBrand(rawText);
  const partName = inferPartName(rawText);

  if (/масл|залил/i.test(lowered)) {
    return {
      intent: 'replace_oil',
      rawText,
      confidence: oilMatch ? 0.91 : 0.78,
      dateMode,
      specificDate,
      mileageKm,
      oilViscosity: normalizeOilViscosity(oilMatch?.[1]),
      oilBrand: manufacturer,
      category: 'manual',
      cost,
    };
  }

  if (partName || /поставил|заменил|сменил/i.test(lowered)) {
    return {
      intent: partName ? 'add_part' : 'note_only',
      rawText,
      confidence: partName ? 0.82 : 0.44,
      dateMode,
      specificDate,
      mileageKm,
      partName,
      manufacturer,
      category: 'manual',
      cost,
      shouldCreatePart: Boolean(partName),
    };
  }

  if (mileageKm && /пробег|км|km/i.test(lowered)) {
    return {
      intent: 'update_mileage',
      rawText,
      confidence: 0.74,
      dateMode,
      specificDate,
      mileageKm,
      category: 'manual',
    };
  }

  return {
    intent: 'note_only',
    rawText,
    confidence: 0.3,
    dateMode,
    specificDate,
    mileageKm,
    category: 'manual',
    partName,
    manufacturer,
    cost,
  };
}

export function buildOwnerExecutionPlan({ command, state, activeCarId, editingJournalId }: BuildPlanInput): OwnerExecutionPlan {
  const occurredAt = resolveOccurredAt(command);
  const previousOilRecord = findPreviousOilRecord(state, activeCarId);
  const recommendedOil = resolveRecommendedOil(state.vehicle.brand, state.vehicle.model);
  const effectiveMileage = command.mileageKm ?? state.vehicle.mileageKm;
  const primaryMaintenance = findPrimaryMaintenanceTask(state.maintenance);
  const nextMileage = command.nextMileage ?? (command.intent === 'replace_oil' ? effectiveMileage + (primaryMaintenance?.intervalKm ?? 10000) : undefined);

  if (command.intent === 'replace_oil') {
    const effectiveOil =
      normalizeOilViscosity(command.oilViscosity) ??
      normalizeOilViscosity(previousOilRecord?.partName) ??
      recommendedOil?.viscosity ??
      '5W-30';
    const oilDescriptor = [command.oilBrand, effectiveOil].filter(Boolean).join(' ');
    const note = command.normalizedText?.trim() || `Заменил масло ${oilDescriptor}`.trim();

    return {
      record: {
        id: editingJournalId ?? `record-${Date.now()}`,
        carId: activeCarId,
        createdAt: occurredAt,
        mileage: effectiveMileage,
        note,
        rawNote: command.rawText,
        category: 'manual',
        partName: oilDescriptor || recommendedOil?.label,
        cost: command.cost,
        nextMileage,
        source: command.confidence >= 0.7 ? 'ai' : 'manual',
      },
      partsToAdd: [],
      updatedVehicleMileageKm: effectiveMileage > state.vehicle.mileageKm ? effectiveMileage : undefined,
      updateMaintenance: true,
      feedback: `Запись о замене масла сохранена. ${effectiveOil ? `Использовано: ${effectiveOil}.` : ''}${recommendedOil ? ` Рекомендация для ${state.vehicle.brand} ${state.vehicle.model}: ${recommendedOil.label}.` : ''}`.trim(),
    };
  }

  if (command.intent === 'add_part' && command.partName) {
    const note = command.normalizedText?.trim() || `Заменил деталь: ${command.partName}`;
    return {
      record: {
        id: editingJournalId ?? `record-${Date.now()}`,
        carId: activeCarId,
        createdAt: occurredAt,
        mileage: command.mileageKm ?? state.vehicle.mileageKm,
        note,
        rawNote: command.rawText,
        category: command.category ?? 'manual',
        partName: command.manufacturer ? `${command.partName} · ${command.manufacturer}` : command.partName,
        cost: command.cost,
        source: command.confidence >= 0.7 ? 'ai' : 'manual',
      },
      partsToAdd: command.shouldCreatePart && !editingJournalId ? [{
        id: `part-${Date.now()}`,
        name: command.partName,
        oem: 'Нужно уточнить',
        manufacturer: command.manufacturer ?? 'Не указан',
        price: command.cost ?? 0,
        status: 'ok',
        note: `Добавлено из быстрой записи: ${command.rawText}`,
        installationSource: 'self',
      }] : [],
      updatedVehicleMileageKm: command.mileageKm && command.mileageKm > state.vehicle.mileageKm ? command.mileageKm : undefined,
      feedback: `Запись по детали сохранена${command.shouldCreatePart ? ' и добавлена в список деталей' : ''}.`,
    };
  }

  if (command.intent === 'update_mileage' && command.mileageKm) {
    return {
      record: {
        id: editingJournalId ?? `record-${Date.now()}`,
        carId: activeCarId,
        createdAt: occurredAt,
        mileage: command.mileageKm,
        note: command.normalizedText?.trim() || `Обновил пробег до ${command.mileageKm.toLocaleString('ru-RU')} км`,
        rawNote: command.rawText,
        category: 'manual',
        source: command.confidence >= 0.7 ? 'ai' : 'manual',
      },
      partsToAdd: [],
      updatedVehicleMileageKm: command.mileageKm,
      feedback: 'Пробег обновлен и заметка сохранена.',
    };
  }

  return {
    record: {
      id: editingJournalId ?? `record-${Date.now()}`,
      carId: activeCarId,
      createdAt: occurredAt,
      mileage: command.mileageKm,
      note: command.normalizedText?.trim() || command.rawText,
      rawNote: command.rawText,
      category: command.category ?? 'manual',
      partName: command.partName,
      cost: command.cost,
      nextMileage: command.nextMileage,
      source: command.confidence >= 0.7 ? 'ai' : 'manual',
    },
    partsToAdd: [],
    updatedVehicleMileageKm: command.mileageKm && command.mileageKm > state.vehicle.mileageKm ? command.mileageKm : undefined,
    feedback: 'Заметка сохранена.',
  };
}
