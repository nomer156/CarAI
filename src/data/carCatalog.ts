export const carCatalog: Record<string, { image: string; accent: string }> = {
  bmw: { image: '/cars/bmw-sport.svg', accent: '#4f8df6' },
  hyundai: {
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/24%20Hyundai%20Tucson%20SE.jpg',
    accent: '#1d7aa8',
  },
  kia: {
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/%2723-%2725%20Kia%20Sportage.JPG',
    accent: '#bc3d3d',
  },
  mercedes: { image: '/cars/mercedes-exec.svg', accent: '#87aabf' },
  toyota: { image: '/cars/toyota-cross.svg', accent: '#d26464' },
  default: { image: '/cars/default-sedan.svg', accent: '#5fa7d8' },
};

export const vehicleBrandOptions = [
  { brand: 'Hyundai', models: ['Tucson', 'Elantra', 'Santa Fe'] },
  { brand: 'Kia', models: ['Sportage', 'K5', 'Sorento'] },
  { brand: 'BMW', models: ['320d Touring', 'X3', '530i'] },
  { brand: 'Mercedes', models: ['C 200', 'GLC 220d', 'E 200'] },
  { brand: 'Toyota', models: ['Camry', 'RAV4', 'Corolla'] },
] as const;

const recommendedOilCatalog: Record<string, Record<string, { viscosity: string; spec: string; label: string }>> = {
  hyundai: {
    tucson: { viscosity: '5W-30', spec: 'API SP / ACEA C3', label: '5W-30, API SP / ACEA C3' },
    elantra: { viscosity: '5W-30', spec: 'API SP', label: '5W-30, API SP' },
    'santa fe': { viscosity: '5W-30', spec: 'ACEA C3', label: '5W-30, ACEA C3' },
  },
  kia: {
    sportage: { viscosity: '5W-30', spec: 'API SP / ACEA C3', label: '5W-30, API SP / ACEA C3' },
    k5: { viscosity: '5W-30', spec: 'API SP', label: '5W-30, API SP' },
    sorento: { viscosity: '5W-30', spec: 'ACEA C3', label: '5W-30, ACEA C3' },
  },
  bmw: {
    '320d touring': { viscosity: '5W-30', spec: 'BMW LL-04', label: '5W-30, BMW LL-04' },
    x3: { viscosity: '5W-30', spec: 'BMW LL-04', label: '5W-30, BMW LL-04' },
    '530i': { viscosity: '0W-30', spec: 'BMW LL-12 FE', label: '0W-30, BMW LL-12 FE' },
  },
  mercedes: {
    'c 200': { viscosity: '5W-30', spec: 'MB 229.5', label: '5W-30, MB 229.5' },
    'glc 220d': { viscosity: '5W-30', spec: 'MB 229.52', label: '5W-30, MB 229.52' },
    'e 200': { viscosity: '5W-30', spec: 'MB 229.5', label: '5W-30, MB 229.5' },
  },
  toyota: {
    camry: { viscosity: '0W-20', spec: 'API SP', label: '0W-20, API SP' },
    rav4: { viscosity: '0W-20', spec: 'API SP', label: '0W-20, API SP' },
    corolla: { viscosity: '0W-20', spec: 'API SP', label: '0W-20, API SP' },
  },
};

export const availableCarColors = [
  'Белый',
  'Черный',
  'Серый',
  'Серебристый',
  'Синий',
  'Красный',
  'Зеленый',
  'Желтый',
  'Коричневый',
];

export function resolveCarVisual(brand: string) {
  const normalized = brand.trim().toLowerCase();
  if (normalized.includes('hyundai')) return carCatalog.hyundai;
  if (normalized.includes('kia')) return carCatalog.kia;
  if (normalized.includes('bmw')) return carCatalog.bmw;
  if (normalized.includes('mercedes')) return carCatalog.mercedes;
  if (normalized.includes('toyota')) return carCatalog.toyota;
  return carCatalog.default;
}

export function resolveRecommendedOil(brand: string, model: string) {
  const brandBucket = recommendedOilCatalog[brand.trim().toLowerCase()];
  if (!brandBucket) return undefined;
  return brandBucket[model.trim().toLowerCase()];
}
