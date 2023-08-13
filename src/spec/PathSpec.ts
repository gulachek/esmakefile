import { isPathLike, Path, isBuildPathLike, BuildPath } from '..';
import { expect } from 'chai';

describe('isPathLike', () => {
	it('returns true for strings', () => {
		expect(isPathLike('hello')).to.be.true;
	});

	it('returns true for Paths', () => {
		expect(isPathLike(Path.src('hello'))).to.be.true;
	});

	it('returns false otherwise', () => {
		expect(isPathLike(true)).to.be.false;
	});
});

describe('isBuildPathLike', () => {
	it('returns true for strings', () => {
		expect(isBuildPathLike('hello')).to.be.true;
	});

	it('returns true for BuildPaths', () => {
		expect(isBuildPathLike(BuildPath.from('hello'))).to.be.true;
	});

	it('returns false otherwise', () => {
		expect(isBuildPathLike(Path.src('hello'))).to.be.false;
	});
});
