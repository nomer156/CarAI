import { openDB } from 'idb';
import type { DBSchema } from 'idb';
import { demoState } from '../data/demoData';
import type { GarageState } from '../types';

type CodexCarDB = DBSchema & {
  app: {
    key: string;
    value: GarageState;
  };
};

const DB_NAME = 'codexcar-db';
const STORE_NAME = 'app';
const STATE_KEY = 'garage-state';

async function getDatabase() {
  return openDB<CodexCarDB>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE_NAME);
    },
  });
}

function normalizeGarageState(state: GarageState | undefined): GarageState {
  if (!state) {
    return demoState;
  }

  return {
    ...demoState,
    ...state,
    cars: state.cars?.length ? state.cars : demoState.cars,
    activeCarId: state.activeCarId ?? state.cars?.[0]?.id ?? demoState.activeCarId,
    journal: (state.journal ?? demoState.journal).map((record) => ({
      ...record,
      assembly: record.assembly ?? undefined,
      subAssembly: record.subAssembly ?? undefined,
    })),
    maintenance: (state.maintenance ?? demoState.maintenance).map((task) => ({
      ...task,
      lastServiceAt: task.lastServiceAt ?? undefined,
      lastServiceMileageKm: task.lastServiceMileageKm ?? undefined,
      lastServiceOrigin: task.lastServiceOrigin ?? undefined,
      lastServiceSubject: task.lastServiceSubject ?? undefined,
    })),
    parts: (state.parts ?? demoState.parts).map((part) => ({
      ...part,
      assembly: part.assembly ?? '',
      subAssembly: part.subAssembly ?? '',
      analogs: part.analogs ?? '',
      installedAt: part.installedAt ?? null,
      installedMileageKm: part.installedMileageKm ?? null,
      nextReplacementKm: part.nextReplacementKm ?? null,
    })),
  };
}

export async function loadGarageState() {
  const db = await getDatabase();
  const state = await db.get(STORE_NAME, STATE_KEY);
  return normalizeGarageState(state);
}

export async function saveGarageState(state: GarageState) {
  const db = await getDatabase();
  await db.put(STORE_NAME, state, STATE_KEY);
}

export async function clearGarageState() {
  const db = await getDatabase();
  await db.delete(STORE_NAME, STATE_KEY);
}
