import { Routes, Route, NavLink } from 'react-router-dom';
import { TonConnectButton } from '@tonconnect/ui-react';

import BountyListPage from './pages/BountyListPage';
import BountyDetailPage from './pages/BountyDetailPage';
import CreateBountyPage from './pages/CreateBountyPage';
import { useTelegramTheme } from './hooks/useTelegramTheme';
import { cn } from './lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Bounties', end: true },
  { to: '/create', label: 'Create' },
];

export default function App() {
  // Syncs Tailwind CSS variables with Telegram's theme params (light/dark, accent colors, ...)
  useTelegramTheme();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">TONBounty</h1>
          <p className="text-xs text-muted-foreground">Permissionless bounties, settled in TON</p>
        </div>
        <TonConnectButton />
      </header>

      <nav className="flex gap-1 border-b border-border px-4 py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 px-4 py-4">
        <Routes>
          <Route path="/" element={<BountyListPage />} />
          <Route path="/bounties/:bountyId" element={<BountyDetailPage />} />
          <Route path="/create" element={<CreateBountyPage />} />
        </Routes>
      </main>
    </div>
  );
}
