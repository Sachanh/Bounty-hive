// Client-side helpers for uploading bounty descriptions and submission proofs
// to IPFS. Uploads are proxied through the backend (backend/src/services/ipfs.ts)
// so that pinning provider API keys (Pinata / web3.storage) never reach the client.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
const IPFS_GATEWAY_URL = import.meta.env.VITE_IPFS_GATEWAY_URL ?? 'https://gateway.pinata.cloud/ipfs';

export type IpfsUploadResult = {
  cid: string;
  gatewayUrl: string;
};

async function uploadJson(payload: Record<string, unknown>): Promise<IpfsUploadResult> {
  const res = await fetch(`${API_BASE_URL}/api/ipfs/upload-json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`IPFS upload failed: ${res.status} ${res.statusText}`);
  const { cid } = (await res.json()) as { cid: string };
  return { cid, gatewayUrl: cidToGatewayUrl(cid) };
}

async function uploadFile(file: File): Promise<IpfsUploadResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE_URL}/api/ipfs/upload-file`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`IPFS upload failed: ${res.status} ${res.statusText}`);
  const { cid } = (await res.json()) as { cid: string };
  return { cid, gatewayUrl: cidToGatewayUrl(cid) };
}

export function cidToGatewayUrl(cid: string): string {
  return `${IPFS_GATEWAY_URL}/${cid}`;
}

export const ipfs = {
  // Pins a bounty description (title, markdown body, category, tags) as JSON.
  uploadBountyDescription: (description: { title: string; body: string; category: string; tags: string[] }) =>
    uploadJson(description),

  // Pins a submission proof — either rich JSON (links, write-up) or a raw file (screenshot, archive, ...).
  uploadSubmissionProof: (proof: { summary: string; links: string[] }) => uploadJson(proof),
  uploadProofFile: (file: File) => uploadFile(file),
};
