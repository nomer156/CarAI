export type UserRole = 'owner' | 'mechanic' | 'service_admin' | 'company_admin';
export type ApprovalStatus = 'approved' | 'pending' | 'inactive';

export type VehicleProfile = {
  brand: string;
  model: string;
  year: number;
  vin: string;
  mileageKm: number;
  engine: string;
  plate: string;
  nextInspection: string;
  color: string;
};

export type Part = {
  id: string;
  name: string;
  oem: string;
  manufacturer: string;
  price: number;
  status: 'ok' | 'watch' | 'replace';
  note: string;
  installationSource: 'self' | 'service';
};

export type MaintenanceTask = {
  id: string;
  title: string;
  dueAtKm: number;
  lastDoneKm: number;
  intervalKm: number;
  priority: 'low' | 'medium' | 'high';
  notes: string;
  items: string[];
};

export type ServiceRecord = {
  id: string;
  date: string;
  title: string;
  location: string;
  mechanic: string;
  verified: boolean;
  details: string;
};

export type AccidentRecord = {
  id: string;
  date: string;
  title: string;
  severity: 'minor' | 'moderate' | 'serious';
  details: string;
};

export type DocumentRecord = {
  id: string;
  title: string;
  category: 'insurance' | 'inspection' | 'invoice' | 'manual';
  issuedAt: string;
  expiresAt?: string;
  verified: boolean;
};

export type MarketplaceOffer = {
  id: string;
  partId: string;
  seller: string;
  condition: 'new' | 'oem' | 'aftermarket';
  price: number;
  etaDays: number;
};

export type MechanicTask = {
  id: string;
  carLabel: string;
  ownerName: string;
  title: string;
  scheduledAt: string;
  bay: string;
  priority: 'low' | 'medium' | 'high';
  status: 'queued' | 'in_progress' | 'done';
};

export type MechanicRecentJob = {
  id: string;
  carLabel: string;
  title: string;
  finishedAt: string;
  verified: boolean;
};

export type StaffMember = {
  id: string;
  name: string;
  role: 'mechanic' | 'service_admin' | 'company_admin' | 'staff';
  approvalStatus: ApprovalStatus;
  specialization: string;
  shift: string;
  workplace: string;
  salaryRub: number;
  workStatus: 'on_shift' | 'off_shift' | 'day_off';
};

export type ServiceQueueItem = {
  id: string;
  customer: string;
  carLabel: string;
  workType: string;
  scheduledAt: string;
  status: 'new' | 'confirmed' | 'in_service' | 'ready';
};

export type ServiceCenterProfile = {
  name: string;
  city: string;
  address: string;
  phone: string;
  workingHours: string;
  bays: number;
  activeOrders: number;
  queueDepth: number;
};

export type ClientProfile = {
  id: string;
  name: string;
  phone: string;
  carLabel: string;
  lastVisit: string;
  serviceCenter: string;
};

export type ActivityLog = {
  id: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
  scope: 'service' | 'platform';
};

export type CompanySnapshot = {
  id: string;
  name: string;
  city: string;
  address: string;
  employees: number;
  owners: number;
  status: 'healthy' | 'review' | 'attention';
};

export type OwnerProfile = {
  id: string;
  name: string;
  city: string;
  vehicles: number;
  lastSeen: string;
};

export type GarageState = {
  role: UserRole;
  approvalStatus: ApprovalStatus;
  ownerName: string;
  mechanicName: string;
  vehicle: VehicleProfile;
  parts: Part[];
  maintenance: MaintenanceTask[];
  records: ServiceRecord[];
  accidents: AccidentRecord[];
  documents: DocumentRecord[];
  offers: MarketplaceOffer[];
  mechanicTasks: MechanicTask[];
  recentJobs: MechanicRecentJob[];
  staff: StaffMember[];
  serviceQueue: ServiceQueueItem[];
  serviceCenter: ServiceCenterProfile;
  clients: ClientProfile[];
  activityLogs: ActivityLog[];
  companies: CompanySnapshot[];
  owners: OwnerProfile[];
};
