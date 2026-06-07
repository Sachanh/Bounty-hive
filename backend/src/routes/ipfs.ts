import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { pinJson, pinFile } from '../services/ipfs.js';

export const ipfsRouter = Router();

const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } }); // 25 MB cap on proof uploads

const descriptionSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  category: z.string().min(1).max(60),
  tags: z.array(z.string().max(40)).max(10).default([]),
});

const proofSchema = z.object({
  summary: z.string().min(1).max(4_000),
  links: z.array(z.string().url()).max(10).default([]),
});

// POST /api/ipfs/upload-json
//
// Pins either a bounty description or a submission proof (rich JSON) to IPFS
// and returns the resulting CID. Keeps Pinata/web3.storage credentials on the
// server — the frontend never sees them (see frontend/src/lib/ipfs.ts).
ipfsRouter.post('/upload-json', async (req, res) => {
  const description = descriptionSchema.safeParse(req.body);
  const proof = proofSchema.safeParse(req.body);

  const payload = description.success ? description.data : proof.success ? proof.data : null;
  if (!payload) {
    return res.status(400).json({ error: 'Body must match either a bounty description or a submission proof shape' });
  }

  try {
    const cid = await pinJson(payload);
    res.json({ cid });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to pin JSON to IPFS' });
  }
});

// POST /api/ipfs/upload-file (multipart/form-data, field name "file")
//
// Pins a raw submission proof file (screenshot, archive, etc.) to IPFS.
ipfsRouter.post('/upload-file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Missing "file" field' });

  try {
    const cid = await pinFile(req.file);
    res.json({ cid });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to pin file to IPFS' });
  }
});
