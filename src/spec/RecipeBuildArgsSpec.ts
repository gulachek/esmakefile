import { RecipeBuildArgs } from '..';
import { expect } from 'chai';
import { Vt100Stream } from '../Vt100Stream';

function mkArgs(): RecipeBuildArgs {
	const stream = new Vt100Stream(); // dummy
	return new RecipeBuildArgs(null, new Set<string>(), stream);
}
describe('RecipeBuildArgs', () => {
	describe('addSrc', () => {
		it('throws when relative path is given', () => {
			const args = mkArgs();
			expect(() => args.addSrc('relative/path')).to.throw();
		});
	});
});
