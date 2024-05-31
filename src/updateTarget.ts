import { Makefile, RuleID } from './Makefile.js';
import { Build } from './Build.js';
import { BuildPathLike } from './Path.js';

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
	const build = new Build(make, goal);
	return build.run();
}

export namespace experimental {
	export interface IDiagnostic {
		msg: string;
	}

	export interface IRecipeResults {
		consoleOutput: string;
		result: boolean;
	}

	interface IUpdateTargetResults {
		result: boolean;
		recipes: Map<RuleID, IRecipeResults>;
		errors: IDiagnostic[];
		warnings: IDiagnostic[];
	}

	export async function updateTarget(
		make: Makefile,
		goal?: BuildPathLike,
	): Promise<IUpdateTargetResults> {
		const build = new Build(make, goal);
		const result = await build.run();

		const { errors, warnings } = build;

		const recipes = new Map<RuleID, IRecipeResults>();

		for (const [ruleId, _, completeInfo] of build.completedRecipes()) {
			recipes.set(ruleId, {
				result: completeInfo.result,
				consoleOutput: build.contentOfLog(ruleId) || '',
			});
		}

		return {
			result,
			errors,
			warnings,
			recipes,
		};
	}
}
