import { Path, cli, Cookbook } from '../index.js';
import { addSass } from './SassRecipe.js';
import { addClangExecutable } from './clang/ClangExecutableRecipe.js';

cli((book: Cookbook) => {
	const scssFile = Path.src('src/style.scss');
	const main = Path.build('main');
	const css = Path.build('style.css');

	book.add('all', [css, main]);

	addSass(book, scssFile, 'style.css');

	addClangExecutable(book, 'main', ['src/main.cpp', 'src/hello.cpp']);
});
