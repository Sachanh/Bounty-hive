import { BOUNTY_DURATIONS } from '@/lib/constants';
import { cn } from '@/lib/utils';

// Bounties may only run for one of the five fixed durations enforced on-chain
// (see contracts/contracts/messages.tact -> isAllowedDuration). This picker
// makes it impossible to select anything else.
export function DurationPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (seconds: number) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {BOUNTY_DURATIONS.map((option) => (
        <button
          key={option.seconds}
          type="button"
          onClick={() => onChange(option.seconds)}
          className={cn(
            'rounded-md border border-border px-2 py-2 text-sm font-medium transition-colors',
            value === option.seconds ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
