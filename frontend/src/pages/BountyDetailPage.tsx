import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatUnits } from '@ton/core';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, type BountyDetail, type Submission } from '@/lib/api';
import { cidToGatewayUrl } from '@/lib/ipfs';

export default function BountyDetailPage() {
  const { bountyId } = useParams<{ bountyId: string }>();
  const [bounty, setBounty] = useState<BountyDetail | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!bountyId) return;
    let cancelled = false;

    Promise.all([api.getBounty(bountyId), api.listSubmissions(bountyId)])
      .then(([bountyData, submissionData]) => {
        if (cancelled) return;
        setBounty(bountyData);
        setSubmissions(submissionData);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Failed to load bounty'));
      });

    return () => {
      cancelled = true;
    };
  }, [bountyId]);

  if (error) return <p className="text-sm text-red-500">{error.message}</p>;
  if (!bounty) return <p className="text-sm text-muted-foreground">Loading bounty…</p>;

  const rewardTon = formatUnits(BigInt(bounty.rewardPerWinnerNanoTon), 9);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-xl">{bounty.title}</CardTitle>
            <Badge>{bounty.status}</Badge>
          </div>
          <CardDescription>
            {bounty.category} · {bounty.winnerSlots} winner slot(s) · {rewardTon} TON each · deadline{' '}
            {new Date(bounty.deadline).toLocaleString()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <article className="prose prose-sm max-w-none whitespace-pre-wrap text-sm">
            {bounty.descriptionMarkdown}
          </article>
          <a
            className="text-xs text-accent underline"
            href={cidToGatewayUrl(bounty.descriptionCid)}
            target="_blank"
            rel="noreferrer"
          >
            View full description on IPFS ({bounty.descriptionCid})
          </a>
          <div>
            <a
              className="text-xs text-muted-foreground underline"
              href={`https://tonscan.org/address/${bounty.contractAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              View escrow contract on-chain
            </a>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Submissions ({submissions.length})</h2>
        <Button size="sm" asChild>
          <a href={`#submit`}>Submit work</a>
        </Button>
      </div>

      <div className="space-y-2">
        {submissions.map((submission) => (
          <Card key={submission.id}>
            <CardContent className="flex items-start justify-between gap-3 p-3 text-sm">
              <div>
                <p className="font-mono text-xs text-muted-foreground">{submission.submitterAddress}</p>
                <p className="mt-1">{submission.proofPreview}</p>
                <a
                  className="text-xs text-accent underline"
                  href={cidToGatewayUrl(submission.proofCid)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View proof on IPFS
                </a>
              </div>
              {submission.isWinner && <Badge variant="secondary">Winner</Badge>}
            </CardContent>
          </Card>
        ))}
        {submissions.length === 0 && (
          <p className="text-sm text-muted-foreground">No submissions yet — open to anyone, no allow-list.</p>
        )}
      </div>
    </div>
  );
}
