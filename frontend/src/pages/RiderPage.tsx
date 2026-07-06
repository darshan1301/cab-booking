import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { AvailableDriver, Ride } from '../api';
import Badge from '../components/Badge';
import AvailableDriversModal from '../components/AvailableDriversModal';

const inputClass =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none';

export default function RiderPage() {
  const [riderName, setRiderName] = useState('Alice');
  const [pickupLat, setPickupLat] = useState('12.9716');
  const [pickupLng, setPickupLng] = useState('77.5946');
  const [notifiedDrivers, setNotifiedDrivers] = useState<string[]>([]);
  const [ride, setRide] = useState<Ride | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [driversModalOpen, setDriversModalOpen] = useState(false);
  const [availableDrivers, setAvailableDrivers] = useState<AvailableDriver[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const refreshAvailableDrivers = async (rideId: string) => {
    try {
      const drivers = await api.getAvailableDrivers(rideId);
      setAvailableDrivers(drivers);
    } finally {
      setDriversLoading(false);
    }
  };

  const startPolling = (rideId: string) => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const latest = await api.getRide(rideId);
        setRide(latest);
        if (latest.state === 'SEARCHING') {
          await refreshAvailableDrivers(rideId);
        }
        if (latest.state === 'ASSIGNED' || latest.state === 'TIMEOUT') {
          stopPolling();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to refresh ride');
        stopPolling();
      }
    }, 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.createRide(riderName, Number(pickupLat), Number(pickupLng));
      setRide(res.ride);
      setNotifiedDrivers(res.notifiedDrivers);
      setAvailableDrivers([]);
      setDriversModalOpen(true);
      setDriversLoading(true);
      startPolling(res.ride.id);
      await refreshAvailableDrivers(res.ride.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ride');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Request a ride</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Creates a ride and polls its status every 2s while allocation is in progress.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">Rider name</label>
          <input className={inputClass} value={riderName} onChange={(e) => setRiderName(e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">Pickup latitude</label>
            <input
              className={inputClass}
              type="number"
              step="any"
              value={pickupLat}
              onChange={(e) => setPickupLat(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">Pickup longitude</label>
            <input
              className={inputClass}
              type="number"
              step="any"
              value={pickupLng}
              onChange={(e) => setPickupLng(e.target.value)}
              required
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {submitting ? 'Requesting…' : 'Request ride'}
        </button>
      </form>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {ride && (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Ride {ride.id}</h2>
            <Badge label={ride.state} />
          </div>
          <dl className="grid grid-cols-2 gap-y-1 text-sm text-neutral-600">
            <dt className="text-neutral-400">Notified drivers</dt>
            <dd>{notifiedDrivers.length ? notifiedDrivers.join(', ') : '—'}</dd>
            <dt className="text-neutral-400">Assigned driver</dt>
            <dd>{ride.assignedDriverId ?? '—'}</dd>
          </dl>
          {ride.state === 'SEARCHING' && <p className="text-xs text-neutral-400">Waiting for a driver to accept…</p>}
          {ride.state === 'TIMEOUT' && <p className="text-xs text-red-500">No driver accepted in time.</p>}
          {ride.state === 'ASSIGNED' && <p className="text-sm text-emerald-600">{ride.assignedDriver?.name} is on the way.</p>}
        </div>
      )}

      <AvailableDriversModal
        open={driversModalOpen}
        loading={driversLoading}
        drivers={availableDrivers}
        ride={ride}
        onClose={() => setDriversModalOpen(false)}
      />
    </div>
  );
}
