import { RecipeArgs } from '../index.js';

import { expect } from 'chai';
import { Writable } from 'node:stream';

function mkArgs(): RecipeArgs {
	return new RecipeArgs(null, new Set<string>(), new Writable());
}
describe('RecipeArgs', () => {
	describe('addPostreq', () => {
		it('throws when relative path is given', () => {
			const args = mkArgs();
			expect(() => args.addPostreq('relative/path')).to.throw();
		});
	});
});
