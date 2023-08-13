import { RecipeBuildArgs } from '..';
import { expect } from 'chai';

function mkArgs(): RecipeBuildArgs {
	return new RecipeBuildArgs(null, new Set<string>());
}
describe('RecipeBuildArgs', () => {
	describe('addSrc', () => {
		it('throws when relative path is given', () => {
			const args = mkArgs();
			expect(() => args.addSrc('relative/path')).to.throw();
		});
	});
});
