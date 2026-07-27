/** @import {Makefile} from 'esmakefile' */
import { getLogger } from 'esmakefile';

import * as sass from 'sass';
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * @param {Makefile} mk
 * @param {string} src
 * @param {string} dest
 * @returns {void}
 */
export function addSass(mk, src, dest) {
	const depsFile = `${dest}.deps.json`;
	const depsMkFile = `${dest}.deps.mk`;

	mk.rule([dest, depsFile], [src], async () => {
		const log = getLogger({ name: 'esmakefile.example.ScssRecipe' });

		log.debug(`sass ${src}`);
		const result = sass.compile(src);

		await writeFile(dest, result.css, 'utf8');

		// update dependencies
		const deps = result.loadedUrls.map((u) => fileURLToPath(u));
		const depsJson = JSON.stringify(deps);
		log.trace(`sass loadedUrls=${deps}`);
		await writeFile(depsFile, depsJson);
	});

	mk.rule(depsMkFile, [depsFile]);
	mk.include(depsMkFile, async (mk) => {
		const deps = JSON.parse(await readFile(depsFile, 'utf8'));
		mk.rule(dest, deps);
	});
}
