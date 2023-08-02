import { Path, cli, Cookbook } from '..';
import { addSass } from './SassRecipe';
import { addClangExecutable } from './clang/ClangExecutableRecipe';

cli((book: Cookbook) => {
	const scssFile = Path.src('src/style.scss');
	addSass(book, scssFile, 'style.css');

	addClangExecutable(book, 'main', ['src/main.cpp', 'src/hello.cpp']);
});
