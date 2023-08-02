import { Path, cli, Cookbook } from '..';
import { addSass } from './SassRecipe';

cli((book: Cookbook) => {
	const scssFile = Path.src('src/style.scss');
	addSass(book, scssFile, 'style.css');
});
