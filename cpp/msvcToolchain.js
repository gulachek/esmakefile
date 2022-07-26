const { Toolchain } = require('./toolchain');
const { spawn } = require('child_process');
const path = require('path');

class MsvcToolchain extends Toolchain {
    get objectExt() { return 'obj'; }
    get archiveExt() { return 'lib'; }
    get executableExt() { return 'exe'; }

    compile(opts) {
        const out = path.parse(opts.outputPath);
        const args = [
            '/c', opts.srcPath,
            '/EHsc',
            `/Fo${out.base}`,
        ];

        switch (opts.cppVersion) {
            case 20:
            case 17:
            case 14:
                args.push(`/std:c++${opts.cppVersion}`);
                break;
            default:
                throw new Error(`msvc does not support c++${opts.cppVersion}`);
                break;
        }

        for (const i of opts.includes) {
            args.push('/I');
            args.push(i);
        }

        if (opts.isDebug) {
            args.push('/Od');
        } else {
            args.push('/Ot');
        }

        /* figure out /showIncludes for depfilePath */

        return spawn('cl', args, {
            stdio: 'inherit',
            cwd: out.dir
        });
    }

    archive(opts) {
        const args = [
            `/OUT:${opts.outputPath}`,
            ...opts.objects
        ];
        return spawn('lib', args, {
            stdio: 'inherit'
        });
    }

    linkExecutable(opts) {
        const args = [
            `/OUT:${opts.outputPath}`,
            ...opts.objects
        ];
        return spawn('link', args, {
            stdio: 'inherit'
        });
    }
}

module.exports = {
    MsvcToolchain
};