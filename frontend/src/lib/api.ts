// Thin client for the TONBounty backend API (backend/ workspace).
// The backend indexes on-chain events and resolves IPFS content so the
// frontend never has to talk to the chain or IPFS directly for *reads*.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export type BountySummary = {
  id: string;
  onchainId: string;
  contractAddress: string;
  creatorAddress: string;
  title: string;
  category: string;
  durationSeconds: number;
  deadline: string; // ISO timestamp
  winnerSlots: number;
  rewardPerWinnerNanoTon: string;
  submissionCount: number;
  status: 'open' | 'awaiting_selection' | 'completed' | 'expired';
};

export type BountyDetail = BountySummary & {
  descriptionCid: string;
  descriptionMarkdown: string;
};

export type Submission = {
  id: string;
  bountyId: string;
  submitterAddress: string;
  proofCid: string;
  proofPreview: string;
  submittedAt: string;
  isWinner: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listBounties: (params?: { category?: string; status?: string; search?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<BountySummary[]>(`/api/bounties${qs ? `?${qs}` : ''}`);
  },
  getBounty: (id: string) => request<BountyDetail>(`/api/bounties/${id}`),
  listSubmissions: (bountyId: string) => request<Submission[]>(`/api/bounties/${bountyId}/submissions`),
  listCategories: () => request<string[]>('/api/categories'),

  // Returns a signed TON/USD price attestation produced by the Omniston relay,
  // to be embedded in the on-chain CreateBounty message (see contracts/README.md).
  getPriceAttestation: () =>
    request<{ tonUsdPriceMilli: string; timestamp: number; signature: string }>('/api/price/attestation'),
};
