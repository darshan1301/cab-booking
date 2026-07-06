const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export type DriverStatus = 'AVAILABLE' | 'BUSY' | 'OFFLINE';
export type RideState = 'REQUESTED' | 'SEARCHING' | 'ASSIGNED' | 'TIMEOUT';

export interface Driver {
  id: string;
  name: string;
  status: DriverStatus;
  createdAt: string;
  updatedAt: string;
  location: { lat: number; lng: number } | null;
}

export interface Ride {
  id: string;
  riderName: string;
  pickupLat: number;
  pickupLng: number;
  state: RideState;
  assignedDriverId: string | null;
  assignedDriver?: Driver | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRideResponse {
  ride: Ride;
  notifiedDrivers: string[];
  attemptId: string;
}

export interface AvailableDriver {
  id: string;
  name: string;
  status: DriverStatus;
  location: { lat: number; lng: number } | null;
  distanceKm: number | null;
}

export interface AcceptRideResponse {
  success: boolean;
  message: string;
  ride: Ride;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.message ?? res.statusText;
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }

  return data as T;
}

export const api = {
  createDriver: (name: string) =>
    request<Driver>('/api/drivers', { method: 'POST', body: JSON.stringify({ name }) }),

  listDrivers: () => request<Driver[]>('/api/drivers'),

  updateDriverStatus: (id: string, status: DriverStatus) =>
    request<Driver>(`/api/drivers/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  updateDriverLocation: (id: string, lat: number, lng: number) =>
    request<{ success: boolean; message: string }>(`/api/drivers/${id}/location`, {
      method: 'POST',
      body: JSON.stringify({ lat, lng }),
    }),

  createRide: (riderName: string, pickupLat: number, pickupLng: number) =>
    request<CreateRideResponse>('/api/rides', {
      method: 'POST',
      body: JSON.stringify({ riderName, pickupLat, pickupLng }),
    }),

  getRide: (id: string) => request<Ride>(`/api/rides/${id}`),

  getAvailableDrivers: (id: string) => request<AvailableDriver[]>(`/api/rides/${id}/drivers`),

  acceptRide: (id: string, driverId: string) =>
    request<AcceptRideResponse>(`/api/rides/${id}/accept`, {
      method: 'POST',
      body: JSON.stringify({ driverId }),
    }),
};
