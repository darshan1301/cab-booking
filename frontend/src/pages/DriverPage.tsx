import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Driver, DriverStatus } from '../api';
import Badge from '../components/Badge';

const inputClass =
  'w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none';

const STATUSES: DriverStatus[] = ['AVAILABLE', 'BUSY', 'OFFLINE'];

interface LocationDraft {
  lat: string;
  lng: string;
}

export default function DriverPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [newDriverName, setNewDriverName] = useState('');
  const [rideId, setRideId] = useState('');
  const [locationDrafts, setLocationDrafts] = useState<Record<string, LocationDraft>>({});
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const refreshDrivers = async () => {
    try {
      const list = await api.listDrivers();
      setDrivers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drivers');
    }
  };

  useEffect(() => {
    refreshDrivers();
    const interval = window.setInterval(refreshDrivers, 3000);
    return () => window.clearInterval(interval);
  }, []);

  const setMessage = (driverId: string, ok: boolean, text: string) => {
    setMessages((prev) => ({ ...prev, [driverId]: { ok, text } }));
  };

  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriverName.trim()) return;
    try {
      await api.createDriver(newDriverName.trim());
      setNewDriverName('');
      await refreshDrivers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create driver');
    }
  };

  const handleStatusChange = async (driverId: string, status: DriverStatus) => {
    try {
      await api.updateDriverStatus(driverId, status);
      await refreshDrivers();
    } catch (err) {
      setMessage(driverId, false, err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const handleLocationUpdate = async (driverId: string) => {
    const draft = locationDrafts[driverId];
    if (!draft?.lat || !draft?.lng) return;
    try {
      await api.updateDriverLocation(driverId, Number(draft.lat), Number(draft.lng));
      setMessage(driverId, true, 'Location updated');
      await refreshDrivers();
    } catch (err) {
      setMessage(driverId, false, err instanceof Error ? err.message : 'Failed to update location');
    }
  };

  const handleAccept = async (driverId: string) => {
    if (!rideId.trim()) {
      setMessage(driverId, false, 'Enter a ride ID above first');
      return;
    }
    try {
      const res = await api.acceptRide(rideId.trim(), driverId);
      setMessage(driverId, true, res.message);
      await refreshDrivers();
    } catch (err) {
      setMessage(driverId, false, err instanceof Error ? err.message : 'Failed to accept ride');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Drivers</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Create drivers, set them available near a pickup point, then accept a ride by ID.
        </p>
      </div>

      <form onSubmit={handleCreateDriver} className="flex gap-2 rounded-lg border border-neutral-200 bg-white p-4">
        <input
          className={inputClass}
          placeholder="New driver name"
          value={newDriverName}
          onChange={(e) => setNewDriverName(e.target.value)}
        />
        <button
          type="submit"
          className="whitespace-nowrap rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Add driver
        </button>
      </form>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <label className="mb-1 block text-sm font-medium text-neutral-700">Ride ID to accept</label>
        <input
          className={inputClass}
          placeholder="Paste ride ID from the Rider tab"
          value={rideId}
          onChange={(e) => setRideId(e.target.value)}
        />
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="space-y-3">
        {drivers.length === 0 && <p className="text-sm text-neutral-400">No drivers yet.</p>}
        {drivers.map((driver) => {
          const draft = locationDrafts[driver.id] ?? { lat: '', lng: '' };
          const message = messages[driver.id];
          return (
            <div key={driver.id} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-neutral-900">{driver.name}</p>
                  <p className="text-xs text-neutral-400">{driver.id}</p>
                </div>
                <Badge label={driver.status} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => handleStatusChange(driver.id, status)}
                    disabled={driver.status === status}
                    className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {status}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs text-neutral-500">Lat</label>
                  <input
                    className={`${inputClass} w-28`}
                    type="number"
                    step="any"
                    value={draft.lat}
                    onChange={(e) =>
                      setLocationDrafts((prev) => ({ ...prev, [driver.id]: { ...draft, lat: e.target.value } }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-neutral-500">Lng</label>
                  <input
                    className={`${inputClass} w-28`}
                    type="number"
                    step="any"
                    value={draft.lng}
                    onChange={(e) =>
                      setLocationDrafts((prev) => ({ ...prev, [driver.id]: { ...draft, lng: e.target.value } }))
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleLocationUpdate(driver.id)}
                  className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
                >
                  Update location
                </button>
                {driver.location && (
                  <span className="text-xs text-neutral-400">
                    current: {driver.location.lat.toFixed(4)}, {driver.location.lng.toFixed(4)}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleAccept(driver.id)}
                className="w-full rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Accept ride as {driver.name}
              </button>

              {message && (
                <p className={`text-xs ${message.ok ? 'text-emerald-600' : 'text-red-600'}`}>{message.text}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
