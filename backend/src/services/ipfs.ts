import axios from 'axios';
import FormData from 'form-data';

import { env } from '../config/env.js';

// Pins bounty descriptions and submission proofs to IPFS via Pinata or
// web3.storage. The frontend never talks to the pinning provider directly —
// API keys/tokens stay server-side (see frontend/src/lib/ipfs.ts).

const pinataClient = axios.create({
  baseURL: 'https://api.pinata.cloud',
  headers: env.PINATA_JWT ? { Authorization: `Bearer ${env.PINATA_JWT}` } : undefined,
});

const web3StorageClient = axios.create({
  baseURL: 'https://api.web3.storage',
  headers: env.WEB3_STORAGE_TOKEN ? { Authorization: `Bearer ${env.WEB3_STORAGE_TOKEN}` } : undefined,
});

async function pinJsonToPinata(payload: Record<string, unknown>): Promise<string> {
  const { data } = await pinataClient.post<{ IpfsHash: string }>('/pinning/pinJSONToIPFS', payload);
  return data.IpfsHash;
}

async function pinFileToPinata(file: Express.Multer.File): Promise<string> {
  const form = new FormData();
  form.append('file', file.buffer, { filename: file.originalname, contentType: file.mimetype });
  const { data } = await pinataClient.post<{ IpfsHash: string }>('/pinning/pinFileToIPFS', form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  });
  return data.IpfsHash;
}

async function uploadJsonToWeb3Storage(payload: Record<string, unknown>): Promise<string> {
  const blob = Buffer.from(JSON.stringify(payload));
  const { data } = await web3StorageClient.post<{ cid: string }>('/upload', blob, {
    headers: { 'Content-Type': 'application/json', 'X-NAME': 'tonbounty-description.json' },
  });
  return data.cid;
}

async function uploadFileToWeb3Storage(file: Express.Multer.File): Promise<string> {
  const { data } = await web3StorageClient.post<{ cid: string }>('/upload', file.buffer, {
    headers: { 'Content-Type': file.mimetype, 'X-NAME': file.originalname },
  });
  return data.cid;
}

export async function pinJson(payload: Record<string, unknown>): Promise<string> {
  return env.IPFS_PROVIDER === 'web3storage' ? uploadJsonToWeb3Storage(payload) : pinJsonToPinata(payload);
}

export async function pinFile(file: Express.Multer.File): Promise<string> {
  return env.IPFS_PROVIDER === 'web3storage' ? uploadFileToWeb3Storage(file) : pinFileToPinata(file);
}
