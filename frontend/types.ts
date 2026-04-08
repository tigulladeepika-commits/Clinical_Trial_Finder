export type TrialLocation = {
  facility: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  status: string | null;
  lat: number | null;
  lon: number | null;
};

export type PointOfContact = {
  name: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
};

export type Trial = {
  nctId: string;
  title: string;
  status: string;
  description: string | null;
  conditions: string[];
  sponsor: string | null;
  phases: string[];
  locations: TrialLocation[];
  inclusionCriteria?: string;
  exclusionCriteria?: string;
  pointOfContact?: PointOfContact | null;
};