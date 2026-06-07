import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard shadcn/ui className helper — merges conditional class lists and
// resolves Tailwind class conflicts.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
