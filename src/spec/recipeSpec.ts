require('jasmine-core');

/*
import { IRecipe, ingredientsOf } from '../recipe';
import { Path } from '../path';

function fakeRecipe(name?: string): jasmine.SpyObj<IRecipe> {
	return jasmine.createSpyObj(name || 'recipe', [
		'sources',
		'targets',
		'buildAsync',
	]);
}

describe('ingredientsOf', () => {
	it('returns an empty array when sources are null', () => {
		const recipe = fakeRecipe();
		recipe.sources.and.returnValue(null);

		const sources = ingredientsOf(recipe);
		expect(sources.length).toEqual(0);
	});

	it('takes a scalar path', () => {
		const recipe = fakeRecipe();
		const path = Path.from('hello');
		recipe.sources.and.returnValue(path);

		const sources = ingredientsOf(recipe);
		expect(sources.length).toEqual(1);
		expect(sources[0]).toBe(path);
	});
});
*/
