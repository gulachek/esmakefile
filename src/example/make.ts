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

	book.add('line-feed', (args) => {
		args.logStream.write('one\ntwo\nthree');
		return false;
	});

	book.add('carriage-return', (args) => {
		args.logStream.write('one\r\ntwo\r\nthree');
		return false;
	});

	book.add('missing-prereq', 'does-not-exist', (args) => {
		return true;
	});

	book.add('warning', (args) => {
		args.logStream.write('Warning: this is a test warning.');
		return true;
	});

	book.add('error', (args) => {
		args.logStream.write('Error: this is a test error.');
		return false;
	});

	book.add('white-space-log', (args) => {
		args.logStream.write('   \n\t\r\n  \n\n  \n');
		return true;
	});
});
