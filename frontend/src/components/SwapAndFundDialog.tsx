import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSwapAndFund, type SwapAndFundParams } from '@/hooks/useSwapAndFund';

const SUPPORTED_ASSETS = [
  { symbol: 'TON', masterAddress: null, decimals: 9 },
  { symbol: 'USDT', masterAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', decimals: 6 },
  { symbol: 'NOT', masterAddress: 'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1giVu63eDA', decimals: 9 },
] as const;

/**
 * "Swap & Fund" — lets a creator who holds USDT (or another supported token)
 * fund a bounty without leaving the app. Under the hood, Omniston quotes the
 * best route to native TON and routes the output straight to the
 * BountyFactory, which forwards it into the new escrow. The platform itself
 * never holds or settles in anything but native TON.
 */
export function SwapAndFundDialog({
  open,
  onOpenChange,
  requiredNanoTon,
  recipient,
  onFunded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requiredNanoTon: bigint;
  recipient: string;
  onFunded: () => void;
}) {
  const [assetSymbol, setAssetSymbol] = useState<(typeof SUPPORTED_ASSETS)[number]['symbol']>('USDT');
  const [amount, setAmount] = useState('');
  const { quote, isQuoting, isSwapping, error, fetchQuote, execute } = useSwapAndFund();

  const asset = SUPPORTED_ASSETS.find((a) => a.symbol === assetSymbol)!;

  const handleQuote = async () => {
    const params: SwapAndFundParams = {
      fromAsset: asset.masterAddress ? asset : null,
      fromAmountHuman: amount,
      requiredNanoTon,
      recipient,
    };
    await fetchQuote(params);
  };

  const handleSwap = async () => {
    if (!quote) return;
    await execute(quote);
    onFunded();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(90vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-4 shadow-lg">
          <Dialog.Title className="text-base font-semibold">Swap & Fund with {assetSymbol}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Pay with another token — Omniston finds the best route to TON and funds the escrow directly.
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="asset">Pay with</Label>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {SUPPORTED_ASSETS.filter((a) => a.masterAddress).map((a) => (
                  <Button
                    key={a.symbol}
                    type="button"
                    variant={assetSymbol === a.symbol ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAssetSymbol(a.symbol)}
                  >
                    {a.symbol}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="amount">Amount ({assetSymbol})</Label>
              <Input
                id="amount"
                inputMode="decimal"
                placeholder="10.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            {quote && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <p>Estimated TON received: ~{(Number(quote.estimatedTonOut) / 1e9).toFixed(4)} TON</p>
                <p className="text-muted-foreground">Price impact: {quote.priceImpactPct.toFixed(2)}%</p>
                <p className="text-muted-foreground">
                  Minimum guaranteed: ~{(Number(quote.minTonOut) / 1e9).toFixed(4)} TON
                </p>
              </div>
            )}

            {error && <p className="text-sm text-red-500">{error.message}</p>}

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={handleQuote} disabled={isQuoting || !amount}>
                {isQuoting ? 'Fetching quote…' : 'Get quote'}
              </Button>
              <Button type="button" onClick={handleSwap} disabled={!quote || isSwapping}>
                {isSwapping ? 'Swapping…' : 'Swap & Fund'}
              </Button>
            </div>
          </div>

          <Dialog.Close asChild>
            <Button type="button" variant="ghost" size="sm" className="mt-3 w-full">
              Cancel
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
