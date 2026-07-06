import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import RiderPage from './pages/RiderPage';
import DriverPage from './pages/DriverPage';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-4 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
  }`;

function App() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <span className="text-lg font-semibold text-neutral-900">Cab Allocation Tester</span>
          <nav className="flex gap-2">
            <NavLink to="/rider" className={navLinkClass}>
              Rider
            </NavLink>
            <NavLink to="/driver" className={navLinkClass}>
              Driver
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/rider" replace />} />
          <Route path="/rider" element={<RiderPage />} />
          <Route path="/driver" element={<DriverPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
