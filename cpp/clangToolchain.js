const { Toolchain } = require('./toolchain');
const { spawn } = require('child_process');

class ClangToolchain extends Toolchain {
	compile(opts) {
		const args = [
			'-fvisibility=hidden',
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
				throw new Error(`clang doesn't support c++${opts.cppVersion}`);
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

		return spawn('c++', args, { stdio: 'inherit' });
	}

	archive(opts) {
		const args = [
			'-static',
			'-o', opts.outputPath,
			...opts.objects
		];
		return spawn('libtool', args, { stdio: 'inherit' });
	}

	linkExecutable(opts) {
		const args = [
			'-o', opts.outputPath,
			...opts.objects
		];
		return spawn('c++', args, { stdio: 'inherit' });
	}
}

module.exports = {
    ClangToolchain
};
