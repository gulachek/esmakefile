import * as path from 'path';

export function rebasePath(
	p: string,
	fromBase: string,
	toBase: string,
): string {
	const pRel = path.relative(fromBase, p);
	if (pRel.includes('..')) {
		throw new Error(
			`Cannot rebase path '${p}' from base '${fromBase}' because it is not within the base path`,
		);
	}

	return path.join(toBase, pRel);
}
