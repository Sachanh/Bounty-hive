import { Cell } from '@ton/core';
import { readFileSync } from 'fs';
import { join } from 'path';

// `@ton/blueprint`'s `compile()` resolves the compiled boc for a Tact project by
// scanning its build virtual filesystem for the first `*.code.boc` entry. When one
// contract imports another (as `BountyManager` imports `PayoutDistributor` for its
// `initOf` deploy), both contracts' artifacts land in that shared filesystem and
// `compile()` can return the wrong one. Read each project's own `.pkg` (written by
// `npm run build`) directly instead — its `code` field is always the right boc.
export function compiledCode(projectName: 'BountyManager' | 'PayoutDistributor'): Cell {
    const pkgPath = join(__dirname, '..', 'build', projectName, `tact_${projectName}.pkg`);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { code: string };
    return Cell.fromBoc(Buffer.from(pkg.code, 'base64'))[0];
}
