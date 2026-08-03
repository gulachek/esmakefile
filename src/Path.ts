import * as path from 'path';

/**
 * Rebase a path from one base directory to another
 * @param p The path to rebase
 * @param fromBase The base directory that `p` is currently relative to
 * @param toBase The base directory to rebase `p` onto
 * @returns The rebased path
 * @remarks Throws if `p` is not within `fromBase`
 */
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
