import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTonAddress } from '@tonconnect/ui-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DurationPicker } from '@/components/DurationPicker';
import { SwapAndFundDialog } from '@/components/SwapAndFundDialog';
import { useOmnistonPrice, minRewardPerWinnerTon } from '@/hooks/useOmnistonPrice';
import { useCreateBounty, rewardToNanoTon } from '@/hooks/useCreateBounty';
import { BOUNTY_DURATIONS, MIN_REWARD_PER_WINNER_USD } from '@/lib/constants';

const FACTORY_ADDRESS = import.meta.env.VITE_BOUNTY_FACTORY_ADDRESS as string;

export default function CreateBountyPage() {
  const navigate = useNavigate();
  const userAddress = useTonAddress();
  const { price } = useOmnistonPrice();
  const { createBounty, isSubmitting, error } = useCreateBounty();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('Development');
  const [durationSeconds, setDurationSeconds] = useState<number>(BOUNTY_DURATIONS[0].seconds);
  const [winnerSlots, setWinnerSlots] = useState(1);
  const [rewardPerWinnerTon, setRewardPerWinnerTon] = useState('1');
  const [swapDialogOpen, setSwapDialogOpen] = useState(false);

  const minTonPerWinner = price ? minRewardPerWinnerTon(price.tonUsd) : null;
  const rewardNumber = Number(rewardPerWinnerTon || '0');

  const meetsMinimum = useMemo(() => {
    if (minTonPerWinner === null) return true; // can't validate without a price yet
    return rewardNumber >= minTonPerWinner;
  }, [minTonPerWinner, rewardNumber]);

  const requiredNanoTon = useMemo(
    () => rewardToNanoTon(rewardNumber) * BigInt(winnerSlots) + 200_000_000n, // + 0.2 TON gas reserve
    [rewardNumber, winnerSlots],
  );

  const canSubmit = Boolean(userAddress) && title && body && meetsMinimum && rewardNumber > 0;

  async function handleSubmit() {
    const result = await createBounty({
      title,
      body,
      category,
      tags: [],
      durationSeconds,
      winnerSlots,
      rewardPerWinnerNanoTon: rewardToNanoTon(rewardNumber),
    });
    navigate(`/?created=${result.contentCid}`);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create a bounty</CardTitle>
          <CardDescription>
            Open to everyone — no approval needed. Funded and paid out entirely in native TON.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Build a TON wallet adapter" />
          </div>

          <div>
            <Label htmlFor="body">Description (markdown, pinned to IPFS)</Label>
            <textarea
              id="body"
              className="mt-1 min-h-[120px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe the task, acceptance criteria, and how to submit proof of work…"
            />
          </div>

          <div>
            <Label htmlFor="category">Category</Label>
            <Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>

          <div>
            <Label>Duration</Label>
            <p className="mb-1 text-xs text-muted-foreground">
              Fixed by the protocol — every bounty must run for exactly one of these durations.
            </p>
            <DurationPicker value={durationSeconds} onChange={setDurationSeconds} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="winners">Winner slots</Label>
              <Input
                id="winners"
                type="number"
                min={1}
                max={50}
                value={winnerSlots}
                onChange={(e) => setWinnerSlots(Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div>
              <Label htmlFor="reward">Reward per winner (TON)</Label>
              <Input
                id="reward"
                type="number"
                min={0}
                step="0.01"
                value={rewardPerWinnerTon}
                onChange={(e) => setRewardPerWinnerTon(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            <p>
              Live price: {price ? `$${price.tonUsd.toFixed(4)} / TON` : 'fetching…'} (via Omniston). Each winner must
              receive at least ${MIN_REWARD_PER_WINNER_USD.toFixed(2)}
              {minTonPerWinner !== null && ` (~${minTonPerWinner.toFixed(4)} TON at the current price)`}.
            </p>
            {!meetsMinimum && (
              <p className="mt-1 font-medium text-red-500">
                Reward per winner is below the platform minimum — increase it before creating the bounty.
              </p>
            )}
            <p className="mt-1">
              Total to escrow:{' '}
              {(Number(requiredNanoTon) / 1e9).toFixed(4)} TON (reward pool + ~0.2 TON gas reserve, refunded if unused)
            </p>
          </div>

          {error && <p className="text-sm text-red-500">{error.message}</p>}

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Fund with TON & create'}
            </Button>
            <Button variant="outline" onClick={() => setSwapDialogOpen(true)} disabled={!canSubmit}>
              Pay with USDT (Swap & Fund)
            </Button>
          </div>

          {!userAddress && <p className="text-xs text-muted-foreground">Connect your TON wallet to continue.</p>}
        </CardContent>
      </Card>

      <SwapAndFundDialog
        open={swapDialogOpen}
        onOpenChange={setSwapDialogOpen}
        requiredNanoTon={requiredNanoTon}
        recipient={FACTORY_ADDRESS}
        onFunded={handleSubmit}
      />
    </div>
  );
}
