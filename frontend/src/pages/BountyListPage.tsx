import { useEffect, useState } from 'react';

import { BountyCard } from '@/components/BountyCard';
import { Input } from '@/components/ui/input';
import { api, type BountySummary } from '@/lib/api';

export default function BountyListPage() {
  const [bounties, setBounties] = useState<BountySummary[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    api
      .listBounties(search ? { search } : undefined)
      .then((data) => {
        if (!cancelled) setBounties(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Failed to load bounties'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search]);

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search bounties…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading bounties…</p>}
      {error && <p className="text-sm text-red-500">{error.message}</p>}
      {!isLoading && !error && bounties.length === 0 && (
        <p className="text-sm text-muted-foreground">No bounties yet — be the first to create one.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {bounties.map((bounty) => (
          <BountyCard key={bounty.id} bounty={bounty} />
        ))}
      </div>
    </div>
  );
}
