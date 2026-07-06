import Badge from './Badge';
import type { AvailableDriver, Ride } from '../api';

interface AvailableDriversModalProps {
  ride: Ride | null;
  open: boolean;
  loading: boolean;
  drivers: AvailableDriver[];
  onClose: () => void;
}

export default function AvailableDriversModal({ ride, open, loading, drivers, onClose }: AvailableDriversModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Available drivers nearby</h2>
            {ride && (
              <p className="text-xs text-neutral-500 mt-0.5">Ride ID: {ride.id}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
          {loading && drivers.length === 0 && (
            <p className="text-sm text-neutral-400">Looking for nearby drivers…</p>
          )}
          {!loading && drivers.length === 0 && (
            <p className="text-sm text-neutral-400">No available drivers found nearby.</p>
          )}
          {drivers.map((driver) => (
            <div
              key={driver.id}
              className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium text-neutral-900">{driver.name}</p>
                <p className="text-xs text-neutral-400">
                  {driver.distanceKm !== null ? `${driver.distanceKm.toFixed(2)} km away` : 'Distance unknown'}
                </p>
              </div>
              <Badge label={driver.status} />
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-neutral-400">
          This list updates automatically while we search for a driver to accept your ride.
        </p>
      </div>
    </div>
  );
}
