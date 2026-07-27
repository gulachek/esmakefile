/*
 * This module exists to work around microsoft/node-pty#919.
 *
 * The problem is that node-pty attempts to use a spawn-helper executable
 * that's not packaged with the proper permissions, so the package is
 * unusable without this workaround on affected platforms.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function fixNodePtyHelper() {
	const platform =
		process.platform === 'darwin'
			? `darwin-${process.arch}`
			: process.platform === 'linux'
				? `linux-${process.arch}`
				: null;

	if (!platform) {
		return;
	}

	let pkg;

	try {
		pkg = require.resolve('node-pty/package.json');
	} catch (ex) {
		console.error(ex);
		return;
	}

	const root = path.dirname(pkg);
	const helper = path.join(root, 'prebuilds', platform, 'spawn-helper');

	try {
		fs.chmodSync(helper, 0o755);
	} catch (err) {
		console.error(err);
	}
}

fixNodePtyHelper();
