import { Makefile } from './Makefile.js';
import { BuildPathLike, Path } from './Path.js';

/**
 * Updates a target in a Makefile.  If no goal is specified,
 * then the first target in the Makefile will be the goal.
 * @summary Updates a target in a Makefile.
 * @param make The Makefile
 * @param goal The desired target to update
 * @return True if the target successfully updates.
 */
export function updateTarget(
	make: Makefile,
	goal?: BuildPathLike,
): Promise<boolean> {
	return make.build(goal && Path.build(goal));
}
