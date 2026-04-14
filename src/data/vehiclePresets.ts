import { resolveRecommendedOil } from './carCatalog';
import type { MaintenanceTask } from '../types';

type VehiclePreset = {
  defaultMileageKm: number;
  engine: string;
  oilIntervalKm: number;
  filterIntervalKm: number;
  brakeIntervalKm: number;
  brakeFluidIntervalKm: number;
  sparkIntervalKm: number;
  coolantIntervalKm: number;
  transmissionIntervalKm: number;
  timingIntervalKm: number;
  timingTitle: string;
  timingNote: string;
  transmissionTitle: string;
};

const defaultPreset: VehiclePreset = {
  defaultMileageKm: 68000,
  engine: '2.0 бензин',
  oilIntervalKm: 10000,
  filterIntervalKm: 15000,
  brakeIntervalKm: 30000,
  brakeFluidIntervalKm: 40000,
  sparkIntervalKm: 60000,
  coolantIntervalKm: 60000,
  transmissionIntervalKm: 60000,
  timingIntervalKm: 90000,
  timingTitle: 'ГРМ / цепь / ролики',
  timingNote: 'Средний ориентир для контроля и замены узлов ГРМ.',
  transmissionTitle: 'Трансмиссия',
};

const modelPresets: Record<string, VehiclePreset> = {
  'hyundai|tucson': { ...defaultPreset, defaultMileageKm: 76000, engine: '2.0 MPI', timingIntervalKm: 120000, timingTitle: 'Цепь ГРМ и натяжители', timingNote: 'Для Tucson чаще контролируют цепь, шум и растяжение.' },
  'hyundai|elantra': { ...defaultPreset, defaultMileageKm: 64000, engine: '1.6 MPI', timingIntervalKm: 110000, timingTitle: 'Цепь ГРМ и натяжители', timingNote: 'Для Elantra держим в поле зрения цепь и натяжитель.' },
  'hyundai|santa fe': { ...defaultPreset, defaultMileageKm: 84000, engine: '2.2 CRDi', transmissionIntervalKm: 70000, timingIntervalKm: 90000, timingTitle: 'Ремень или цепь ГРМ', timingNote: 'Уточните тип мотора и скорректируйте интервал под ваш двигатель.' },
  'kia|sportage': { ...defaultPreset, defaultMileageKm: 72000, engine: '2.0 MPI', timingIntervalKm: 120000, timingTitle: 'Цепь ГРМ и натяжители', timingNote: 'Sportage часто идет с цепью: регламент лучше вести отдельно от масла.' },
  'kia|k5': { ...defaultPreset, defaultMileageKm: 58000, engine: '2.0 MPI', transmissionIntervalKm: 60000, timingIntervalKm: 120000, timingTitle: 'Цепь ГРМ и натяжители', timingNote: 'Для K5 удобно заранее держать на контроле цепь и масло АКПП.' },
  'kia|sorento': { ...defaultPreset, defaultMileageKm: 88000, engine: '2.2 CRDi', transmissionIntervalKm: 70000, timingIntervalKm: 90000, timingTitle: 'Ремень или цепь ГРМ', timingNote: 'Проверьте двигатель и поправьте интервал под конкретную версию Sorento.' },
  'bmw|320d touring': { ...defaultPreset, defaultMileageKm: 93000, engine: '2.0d', oilIntervalKm: 12000, filterIntervalKm: 15000, brakeIntervalKm: 35000, coolantIntervalKm: 80000, transmissionIntervalKm: 80000, timingIntervalKm: 140000, timingTitle: 'Цепь ГРМ и навесное', timingNote: 'Для дизельных BMW цепь и шумы на холодную лучше держать в отдельном контроле.', transmissionTitle: 'АКПП, редуктор и приводы' },
  'bmw|x3': { ...defaultPreset, defaultMileageKm: 98000, engine: '2.0d xDrive', oilIntervalKm: 12000, filterIntervalKm: 15000, brakeIntervalKm: 35000, coolantIntervalKm: 80000, transmissionIntervalKm: 80000, timingIntervalKm: 140000, timingTitle: 'Цепь ГРМ и навесное', timingNote: 'Для X3 важно учитывать коробку, раздатку и приводы.', transmissionTitle: 'АКПП, раздатка и приводы' },
  'bmw|530i': { ...defaultPreset, defaultMileageKm: 87000, engine: '2.0 turbo', oilIntervalKm: 10000, filterIntervalKm: 15000, brakeIntervalKm: 32000, coolantIntervalKm: 70000, transmissionIntervalKm: 70000, timingIntervalKm: 130000, timingTitle: 'Цепь ГРМ и натяжители', timingNote: 'Турбо-бензин лучше вести по сокращенному интервалу масла и контролю цепи.', transmissionTitle: 'АКПП и редуктор' },
  'mercedes|c 200': { ...defaultPreset, defaultMileageKm: 82000, engine: '1.5 turbo', oilIntervalKm: 12000, filterIntervalKm: 15000, brakeIntervalKm: 32000, coolantIntervalKm: 70000, transmissionIntervalKm: 70000, timingIntervalKm: 130000, timingTitle: 'Цепь ГРМ и фазорегуляторы', timingNote: 'Для C 200 удобно держать отдельно цепь и навесной привод.' },
  'mercedes|glc 220d': { ...defaultPreset, defaultMileageKm: 104000, engine: '2.0d', oilIntervalKm: 12000, filterIntervalKm: 15000, brakeIntervalKm: 35000, coolantIntervalKm: 80000, transmissionIntervalKm: 80000, timingIntervalKm: 140000, timingTitle: 'Цепь ГРМ и навесное', timingNote: 'Для дизельного GLC важны цепь, масло коробки и полный привод.', transmissionTitle: 'АКПП, раздатка и приводы' },
  'mercedes|e 200': { ...defaultPreset, defaultMileageKm: 91000, engine: '2.0 turbo', oilIntervalKm: 12000, filterIntervalKm: 15000, brakeIntervalKm: 32000, coolantIntervalKm: 70000, transmissionIntervalKm: 70000, timingIntervalKm: 130000, timingTitle: 'Цепь ГРМ и фазорегуляторы', timingNote: 'Бизнес-седан лучше вести по отдельным интервалам масла, коробки и цепи.' },
  'toyota|camry': { ...defaultPreset, defaultMileageKm: 69000, engine: '2.5 бензин', oilIntervalKm: 10000, filterIntervalKm: 15000, brakeIntervalKm: 30000, transmissionIntervalKm: 60000, timingIntervalKm: 140000, timingTitle: 'Цепь ГРМ и натяжители', timingNote: 'Для Camry обычно достаточно контроля цепи и планового сервиса масла АКПП.' },
  'toyota|rav4': { ...defaultPreset, defaultMileageKm: 74000, engine: '2.0 бензин', oilIntervalKm: 10000, filterIntervalKm: 15000, brakeIntervalKm: 30000, transmissionIntervalKm: 60000, timingIntervalKm: 140000, timingTitle: 'Цепь ГРМ и натяжители', timingNote: 'Для RAV4 полезно следить за трансмиссией и приводами вместе с цепью.' },
  'toyota|corolla': { ...defaultPreset, defaultMileageKm: 62000, engine: '1.6 бензин', oilIntervalKm: 10000, filterIntervalKm: 15000, brakeIntervalKm: 30000, transmissionIntervalKm: 60000, timingIntervalKm: 140000, timingTitle: 'Цепь ГРМ и натяжители', timingNote: 'У Corolla простой и понятный базовый регламент, который удобно корректировать вручную.' },
};

function presetKey(brand: string, model: string) {
  return `${brand.trim().toLowerCase()}|${model.trim().toLowerCase()}`;
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function nextInspectionDate(referenceDate: string) {
  const date = new Date(referenceDate || todayInputValue());
  if (Number.isNaN(date.getTime())) return '';
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

function createMaintenanceTask(
  id: string,
  title: string,
  intervalKm: number,
  priority: 'low' | 'medium' | 'high',
  notes: string,
  items: string[],
  lastDoneKm: number,
) {
  return {
    id,
    title,
    dueAtKm: lastDoneKm + intervalKm,
    lastDoneKm,
    intervalKm,
    priority,
    notes,
    items,
  } satisfies MaintenanceTask;
}

export function resolveVehiclePreset(brand: string, model: string) {
  return modelPresets[presetKey(brand, model)] ?? defaultPreset;
}

export function resolveVehicleDefaults(brand: string, model: string, referenceDate = todayInputValue()) {
  const preset = resolveVehiclePreset(brand, model);
  return {
    defaultMileageKm: preset.defaultMileageKm,
    engine: preset.engine,
    nextInspection: nextInspectionDate(referenceDate),
  };
}

export function buildMaintenanceTemplateForVehicle(brand: string, model: string, mileageKm = 0, referenceDate = todayInputValue()) {
  const preset = resolveVehiclePreset(brand, model);
  const oilRecommendation = resolveRecommendedOil(brand, model);
  const oilLabel = oilRecommendation?.label ? `Рекомендуемое масло: ${oilRecommendation.label}.` : 'Подберите масло под допуск вашего двигателя.';
  const registrationNote = `Стартовая точка: ${referenceDate}. Эти интервалы заполнены автоматически для ${brand || 'выбранного авто'} ${model || ''} и потом легко корректируются вручную.`;

  return [
    createMaintenanceTask('oil-service', 'Масло двигателя и фильтр', preset.oilIntervalKm, 'high', `${registrationNote} ${oilLabel}`, ['Замена масла двигателя', 'Замена масляного фильтра', 'Осмотр течей по двигателю', 'Контроль уровня рабочих жидкостей'], mileageKm),
    createMaintenanceTask('filters-service', 'Воздушный и салонный фильтры', preset.filterIntervalKm, 'medium', `${registrationNote} Фильтры удобно менять парой и отмечать отдельно от масла.`, ['Замена воздушного фильтра', 'Замена салонного фильтра', 'Осмотр корпуса фильтра и воздуховодов'], mileageKm),
    createMaintenanceTask('brake-service', 'Тормозные колодки и диски', preset.brakeIntervalKm, 'medium', `${registrationNote} Базовый ресурс рассчитан для спокойной городской эксплуатации.`, ['Осмотр передних и задних колодок', 'Проверка тормозных дисков', 'Контроль направляющих и износа'], mileageKm),
    createMaintenanceTask('brake-fluid', 'Тормозная жидкость', preset.brakeFluidIntervalKm, 'high', `${registrationNote} Жидкость меняется по пробегу или раз в 2 года.`, ['Замена тормозной жидкости', 'Прокачка контуров', 'Проверка шлангов и соединений'], mileageKm),
    createMaintenanceTask('spark-service', 'Свечи и зажигание', preset.sparkIntervalKm, 'medium', `${registrationNote} Для стабильного пуска и ровной работы двигателя держите этот этап в отдельном контроле.`, ['Замена свечей', 'Осмотр катушек и разъемов', 'Диагностика пропусков воспламенения'], mileageKm),
    createMaintenanceTask('coolant-service', 'Охлаждающая жидкость', preset.coolantIntervalKm, 'medium', `${registrationNote} Система охлаждения обслуживается вместе с осмотром патрубков и радиаторов.`, ['Замена охлаждающей жидкости', 'Проверка патрубков и хомутов', 'Осмотр радиаторов и крышки бачка'], mileageKm),
    createMaintenanceTask('transmission-service', preset.transmissionTitle, preset.transmissionIntervalKm, 'medium', `${registrationNote} Интервал рассчитан для среднего сценария и может отличаться у АКПП, МКПП и полного привода.`, ['Проверка или замена масла коробки', 'Осмотр сцепления или гидроблока', 'Контроль приводов, ШРУСов и течей'], mileageKm),
    createMaintenanceTask('timing-service', preset.timingTitle, preset.timingIntervalKm, 'high', `${registrationNote} ${preset.timingNote}`, ['Контроль цепи или ремня ГРМ', 'Осмотр роликов и натяжителей', 'Замена комплекта по регламенту и состоянию'], mileageKm),
  ];
}
