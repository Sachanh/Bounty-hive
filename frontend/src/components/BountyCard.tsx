import { Link } from 'react-router-dom';
import { formatUnits } from '@ton/core';

import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { BountySummary } from '@/lib/api';

const STATUS_LABEL: Record<BountySummary['status'], string> = {
  open: 'Open for submissions',
  awaiting_selection: 'Awaiting winner selection',
  completed: 'Completed',
  expired: 'Expired',
};

const STATUS_VARIANT: Record<BountySummary['status'], 'default' | 'secondary' | 'outline'> = {
  open: 'default',
  awaiting_selection: 'secondary',
  completed: 'outline',
  expired: 'outline',
};

function formatHours(seconds: number): string {
  return `${Math.round(seconds / 3600)}h`;
}

export function BountyCard({ bounty }: { bounty: BountySummary }) {
  const rewardTon = formatUnits(BigInt(bounty.rewardPerWinnerNanoTon), 9);

  return (
    <Link to={`/bounties/${bounty.id}`}>
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle>{bounty.title}</CardTitle>
            <Badge variant={STATUS_VARIANT[bounty.status]}>{STATUS_LABEL[bounty.status]}</Badge>
          </div>
          <CardDescription>
            {bounty.category} · {formatHours(bounty.durationSeconds)} duration · {bounty.winnerSlots} winner
            {bounty.winnerSlots > 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4 text-sm">
          <span className="font-medium">{rewardTon} TON / winner</span>
          <span className="text-muted-foreground">{bounty.submissionCount} submissions</span>
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          Deadline: {new Date(bounty.deadline).toLocaleString()}
        </CardFooter>
      </Card>
    </Link>
  );
}
