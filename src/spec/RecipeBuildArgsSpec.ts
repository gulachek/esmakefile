import { RecipeBuildArgs } from '../index.js';

import { expect } from 'chai';
import { Writable } from 'node:stream';

function mkArgs(): RecipeBuildArgs {
	return new RecipeBuildArgs(null, new Set<string>(), new Writable());
}
describe('RecipeBuildArgs', () => {
	describe('addSrc', () => {
		it('throws when relative path is given', () => {
			const args = mkArgs();
			expect(() => args.addSrc('relative/path')).to.throw();
		});
	});
});
