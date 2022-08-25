const { Toolchain } = require('../toolchain');
const { spawn } = require('child_process');
const fs = require('fs');

class GccToolchain extends Toolchain {
	get importDef() { return '__attribute__((visibility("default")))'; }
	get exportDef() { return '__attribute__((visibility("default")))'; }

	compile(opts) {
		const args = [
			'-fvisibility=hidden',
			'-fPIC',
			'-Wall',
			'-MD', '-MF', opts.depfilePath,
			'-o', opts.outputPath,
			'-c', opts.srcPath
		];

		switch (opts.cppVersion) {
			case 20:
			case 17:
			case 14:
			case 11:
			case 98:
				args.push(`-std=c++${opts.cppVersion}`);
				break;
			default:
				throw new Error(`gcc doesn't support c++${opts.cppVersion}`);
				break;
		}

		if (opts.isDebug) {
			args.push('-g');
			args.push('-Og');
		} else {
			args.push('-O3');
		}

		for (const i of opts.includes) {
			args.push('-I');
			args.push(i);
		}

		for (const [key, val] of opts.definitions) {
			args.push('-D');
			args.push(`${key}=${val}`);
		}

		return spawn('g++', args, { stdio: 'inherit' });
	}

	archive(opts) {
		const args = [
			'crs',
			opts.outputPath,
			...opts.objects
		];
		return spawn('ar', args, { stdio: 'inherit' });
	}

	link(opts) {
		const args = [];
		switch (opts.type) {
			case 'executable':
				break;
			case 'dynamicLib':
				args.push('-shared');
				break;
			default:
				throw new Error(`Image type not handled: ${opts.type}`);
				break;
		}

		args.push('-Wl,--exclude-libs,ALL');
		args.push('-o');
		args.push(opts.outputPath);
		for (const o of opts.objects) {
			args.push(o);
		}

		for (const lib of opts.libraries) {
			args.push(lib.path);
		}

		return spawn('g++', args, { stdio: 'inherit' });
	}

	*depfileEntries(path) {
		let contents = fs.readFileSync(path, { encoding: 'utf8' });

		// handle escaped new lines for logical line
		contents = contents.replace("\\\n", " ");

		let index = contents.indexOf(': ');
		if (index === -1) {
			throw new Error(`expected target to end with ': ' in depfile '${path}'`);
		}

		index += 2; // due to ': '

		for (let fstart = NaN; index < contents.length; ++index) {
			if (contents[index].match(/\s/)) {
				if (fstart) {
					yield contents.slice(fstart, index)
						.replace("\\ ", " ");
					fstart = NaN;
				}
			}
			// let's just assume all \ is escape. make is weird about this
			// so technically wrong but who cares
			else if (contents[index] === '\\') {
				++index;
			}
			else if (!fstart) {
				fstart = index;
			}
		}
	}
}

module.exports = {
	GccToolchain
};
