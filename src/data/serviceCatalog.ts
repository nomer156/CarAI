export type ServiceCatalogItem = {
  id: string;
  assembly: string;
  subAssembly: string;
  label: string;
  aliases: string[];
  maintenanceTaskId?: string;
};

export const serviceCatalog: ServiceCatalogItem[] = [
  { id: 'engine-oil', assembly: 'Двигатель', subAssembly: 'Система смазки', label: 'Масло двигателя', aliases: ['моторное масло', 'масло двс', 'engine oil'], maintenanceTaskId: 'oil-service' },
  { id: 'oil-filter', assembly: 'Двигатель', subAssembly: 'Система смазки', label: 'Масляный фильтр', aliases: ['фильтр масла', 'oil filter'], maintenanceTaskId: 'oil-service' },
  { id: 'air-filter', assembly: 'Двигатель', subAssembly: 'Впуск и фильтры', label: 'Воздушный фильтр', aliases: ['фильтр двигателя', 'air filter'], maintenanceTaskId: 'filters-service' },
  { id: 'fuel-filter', assembly: 'Двигатель', subAssembly: 'Топливная система', label: 'Топливный фильтр', aliases: ['фильтр топлива', 'fuel filter'], maintenanceTaskId: 'filters-service' },
  { id: 'spark-plugs', assembly: 'Двигатель', subAssembly: 'Система зажигания', label: 'Свечи зажигания', aliases: ['свечи', 'spark plugs'], maintenanceTaskId: 'spark-service' },
  { id: 'ignition-coil', assembly: 'Двигатель', subAssembly: 'Система зажигания', label: 'Катушки зажигания', aliases: ['катушка', 'ignition coil'], maintenanceTaskId: 'spark-service' },
  { id: 'timing-kit', assembly: 'Двигатель', subAssembly: 'Газораспределительный механизм', label: 'Комплект ГРМ', aliases: ['ремень грм', 'грм', 'timing belt'], maintenanceTaskId: 'timing-service' },
  { id: 'timing-chain', assembly: 'Двигатель', subAssembly: 'Газораспределительный механизм', label: 'Цепь ГРМ', aliases: ['цепь', 'timing chain'], maintenanceTaskId: 'timing-service' },
  { id: 'timing-tensioner', assembly: 'Двигатель', subAssembly: 'Газораспределительный механизм', label: 'Натяжитель ГРМ', aliases: ['натяжитель', 'ролик грм'], maintenanceTaskId: 'timing-service' },
  { id: 'water-pump', assembly: 'Двигатель', subAssembly: 'Система охлаждения', label: 'Помпа охлаждения', aliases: ['водяная помпа', 'насос охлаждения'], maintenanceTaskId: 'coolant-service' },
  { id: 'coolant', assembly: 'Двигатель', subAssembly: 'Система охлаждения', label: 'Охлаждающая жидкость', aliases: ['антифриз', 'coolant'], maintenanceTaskId: 'coolant-service' },
  { id: 'radiator', assembly: 'Двигатель', subAssembly: 'Система охлаждения', label: 'Радиатор охлаждения', aliases: ['радиатор', 'cooling radiator'], maintenanceTaskId: 'coolant-service' },
  { id: 'thermostat', assembly: 'Двигатель', subAssembly: 'Система охлаждения', label: 'Термостат', aliases: ['термостат двигателя'], maintenanceTaskId: 'coolant-service' },
  { id: 'throttle-body', assembly: 'Двигатель', subAssembly: 'Впуск и фильтры', label: 'Дроссельная заслонка', aliases: ['дроссель'], maintenanceTaskId: 'filters-service' },
  { id: 'engine-mount', assembly: 'Двигатель', subAssembly: 'Опоры агрегатов', label: 'Опора двигателя', aliases: ['подушка двигателя', 'engine mount'] },

  { id: 'gearbox-oil-manual', assembly: 'Трансмиссия', subAssembly: 'Механическая коробка передач', label: 'Масло МКПП', aliases: ['масло коробки', 'масло мкпп', 'manual gearbox oil'], maintenanceTaskId: 'transmission-service' },
  { id: 'gearbox-oil-auto', assembly: 'Трансмиссия', subAssembly: 'Автоматическая коробка передач', label: 'Масло АКПП', aliases: ['масло акпп', 'atf', 'automatic gearbox oil'], maintenanceTaskId: 'transmission-service' },
  { id: 'gearbox-filter-auto', assembly: 'Трансмиссия', subAssembly: 'Автоматическая коробка передач', label: 'Фильтр АКПП', aliases: ['фильтр акпп'], maintenanceTaskId: 'transmission-service' },
  { id: 'clutch-kit', assembly: 'Трансмиссия', subAssembly: 'Система сцепления', label: 'Комплект сцепления', aliases: ['сцепление', 'диск сцепления', 'clutch kit'], maintenanceTaskId: 'transmission-service' },
  { id: 'release-bearing', assembly: 'Трансмиссия', subAssembly: 'Система сцепления', label: 'Выжимной подшипник', aliases: ['выжимной'], maintenanceTaskId: 'transmission-service' },
  { id: 'cv-joint', assembly: 'Трансмиссия', subAssembly: 'Привод колеса', label: 'ШРУС', aliases: ['граната', 'cv joint'], maintenanceTaskId: 'transmission-service' },
  { id: 'drive-shaft', assembly: 'Трансмиссия', subAssembly: 'Привод колеса', label: 'Приводной вал', aliases: ['полуось', 'drive shaft'], maintenanceTaskId: 'transmission-service' },
  { id: 'axle-seal', assembly: 'Трансмиссия', subAssembly: 'Привод колеса', label: 'Сальник привода', aliases: ['сальник полуоси'], maintenanceTaskId: 'transmission-service' },

  { id: 'front-pads', assembly: 'Тормозная система', subAssembly: 'Передние тормоза', label: 'Передние тормозные колодки', aliases: ['передние колодки', 'колодки'], maintenanceTaskId: 'brake-service' },
  { id: 'rear-pads', assembly: 'Тормозная система', subAssembly: 'Задние тормоза', label: 'Задние тормозные колодки', aliases: ['задние колодки'], maintenanceTaskId: 'brake-service' },
  { id: 'front-discs', assembly: 'Тормозная система', subAssembly: 'Передние тормоза', label: 'Передние тормозные диски', aliases: ['передние диски'], maintenanceTaskId: 'brake-service' },
  { id: 'rear-discs', assembly: 'Тормозная система', subAssembly: 'Задние тормоза', label: 'Задние тормозные диски', aliases: ['задние диски'], maintenanceTaskId: 'brake-service' },
  { id: 'brake-fluid', assembly: 'Тормозная система', subAssembly: 'Гидравлическая система', label: 'Тормозная жидкость', aliases: ['тормозуха', 'brake fluid'], maintenanceTaskId: 'brake-fluid' },
  { id: 'brake-hose', assembly: 'Тормозная система', subAssembly: 'Гидравлическая система', label: 'Тормозной шланг', aliases: ['шланг тормозной'], maintenanceTaskId: 'brake-service' },
  { id: 'parking-brake-cable', assembly: 'Тормозная система', subAssembly: 'Стояночный тормоз', label: 'Трос ручника', aliases: ['трос стояночного тормоза'] },

  { id: 'front-shock', assembly: 'Подвеска и рулевое', subAssembly: 'Передняя подвеска', label: 'Передний амортизатор', aliases: ['стойка амортизатора', 'front shock'] },
  { id: 'rear-shock', assembly: 'Подвеска и рулевое', subAssembly: 'Задняя подвеска', label: 'Задний амортизатор', aliases: ['rear shock'] },
  { id: 'control-arm', assembly: 'Подвеска и рулевое', subAssembly: 'Передняя подвеска', label: 'Рычаг подвески', aliases: ['рычаг', 'control arm'] },
  { id: 'stabilizer-link', assembly: 'Подвеска и рулевое', subAssembly: 'Передняя подвеска', label: 'Стойка стабилизатора', aliases: ['линк стабилизатора', 'stabilizer link'] },
  { id: 'wheel-bearing', assembly: 'Подвеска и рулевое', subAssembly: 'Ступица и подшипники', label: 'Подшипник ступицы', aliases: ['ступичный подшипник', 'wheel bearing'] },
  { id: 'tie-rod-end', assembly: 'Подвеска и рулевое', subAssembly: 'Рулевое управление', label: 'Рулевой наконечник', aliases: ['наконечник рулевой тяги'] },
  { id: 'steering-rack', assembly: 'Подвеска и рулевое', subAssembly: 'Рулевое управление', label: 'Рулевая рейка', aliases: ['steering rack'] },

  { id: 'battery', assembly: 'Электрика', subAssembly: 'Пуск и зарядка', label: 'Аккумулятор', aliases: ['акб', 'battery'] },
  { id: 'alternator', assembly: 'Электрика', subAssembly: 'Пуск и зарядка', label: 'Генератор', aliases: ['alternator'] },
  { id: 'starter', assembly: 'Электрика', subAssembly: 'Пуск и зарядка', label: 'Стартер', aliases: ['starter'] },
  { id: 'alternator-belt', assembly: 'Электрика', subAssembly: 'Навесное оборудование', label: 'Ремень навесного оборудования', aliases: ['ремень генератора', 'serpentine belt'] },
  { id: 'headlamp-bulb', assembly: 'Электрика', subAssembly: 'Освещение', label: 'Лампа ближнего света', aliases: ['лампа фары', 'headlamp bulb'] },

  { id: 'cabin-filter', assembly: 'Климат и салон', subAssembly: 'Система вентиляции', label: 'Салонный фильтр', aliases: ['фильтр салона', 'cabin filter'], maintenanceTaskId: 'filters-service' },
  { id: 'ac-compressor', assembly: 'Климат и салон', subAssembly: 'Кондиционер', label: 'Компрессор кондиционера', aliases: ['компрессор кондиционера', 'ac compressor'] },
  { id: 'blower-motor', assembly: 'Климат и салон', subAssembly: 'Система вентиляции', label: 'Мотор печки', aliases: ['вентилятор печки', 'blower motor'] },
  { id: 'wiper-blades', assembly: 'Кузов и стекла', subAssembly: 'Стеклоочистители', label: 'Щетки стеклоочистителя', aliases: ['дворники', 'щетки дворников'] },
  { id: 'washer-pump', assembly: 'Кузов и стекла', subAssembly: 'Стеклоомыватель', label: 'Насос омывателя', aliases: ['моторчик омывателя'] },
];

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getServiceAssemblies() {
  return [...new Set(serviceCatalog.map((item) => item.assembly))];
}

export function getServiceSubAssemblies(assembly?: string) {
  return [...new Set(serviceCatalog
    .filter((item) => !assembly || item.assembly === assembly)
    .map((item) => item.subAssembly))];
}

export function getServiceCatalogItem(itemId?: string | null) {
  if (!itemId) return null;
  return serviceCatalog.find((item) => item.id === itemId) ?? null;
}

export function findServiceCatalogItem(label: string, assembly?: string, subAssembly?: string) {
  const normalizedLabel = normalizeSearchValue(label);
  if (!normalizedLabel) return null;
  return serviceCatalog.find((item) => normalizeSearchValue(item.label) === normalizedLabel
    && (!assembly || item.assembly === assembly)
    && (!subAssembly || item.subAssembly === subAssembly)) ?? null;
}

export function suggestServiceCatalogItems(query: string, assembly?: string, subAssembly?: string, limit = 8) {
  const normalizedQuery = normalizeSearchValue(query);
  const pool = serviceCatalog.filter((item) => (!assembly || item.assembly === assembly) && (!subAssembly || item.subAssembly === subAssembly));
  if (!normalizedQuery) return pool.slice(0, limit);

  const ranked = pool
    .map((item) => {
      const searchFields = [item.label, item.assembly, item.subAssembly, ...item.aliases].map(normalizeSearchValue);
      const startsWith = searchFields.some((field) => field.startsWith(normalizedQuery));
      const includes = searchFields.some((field) => field.includes(normalizedQuery));
      const score = startsWith ? 3 : includes ? 2 : 0;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.label.localeCompare(right.item.label, 'ru-RU'))
    .slice(0, limit);

  return ranked.map((entry) => entry.item);
}
