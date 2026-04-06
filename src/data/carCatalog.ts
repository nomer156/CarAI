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

export const availableCarColors = [
  'Midnight Blue',
  'Pearl White',
  'Graphite Gray',
  'Crimson Red',
  'Forest Green',
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
