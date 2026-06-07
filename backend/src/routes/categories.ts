import { Router } from 'express';

import { supabase } from '../db/client.js';

export const categoriesRouter = Router();

// GET /api/categories — distinct categories across all bounties, for filter UI.
categoriesRouter.get('/', async (_req, res) => {
  const { data, error } = await supabase.from('bounties').select('category');
  if (error) return res.status(500).json({ error: error.message });

  const categories = Array.from(new Set((data ?? []).map((row) => row.category))).sort();
  res.json(categories);
});
