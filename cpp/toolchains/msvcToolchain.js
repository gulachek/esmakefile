const { Toolchain } = require('../toolchain');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { LineReader } = require('./lineReader');
const { StaticPath } = require('../../lib/pathTargets');

class MsvcToolchain extends Toolchain {
    get objectExt() { return 'obj'; }
    get archiveExt() { return 'lib'; }
    get executableExt() { return 'exe'; }
    get dynamicLibExt() { return 'dynamic.lib'; }
    get importDef() { return '__declspec(dllimport)'; }
    get exportDef() { return '__declspec(dllexport)'; }
    get dynamicLibraryIsLinked() { return false; }

    async compile(opts) {
        const out = path.parse(opts.outputPath);
        const args = [
            '/nologo',
            '/c', opts.srcPath,
            '/EHsc',
            `/Fo${out.base}`,
            '/showIncludes'
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
            args.push('/MDd');
		args.push('/Z7');
        } else {
            args.push('/Ot');
            args.push('/MD');
        }
        // eventually will need support for /MT[d] and maybe /LD[d]
        // better to have a use case to design for than to preemptively design the wrong thing.

        for (const [key,val] of opts.definitions) {
            args.push('/D');
            args.push(`${key}=${val}`);
        }

        const depfile = fs.createWriteStream(opts.depfilePath, 'utf8');
        let dfProm = new Promise((resolve) => {
            depfile.on('ready', resolve);
        });

        const proc = spawn('cl', args, {
            stdio: ['inherit', 'pipe', 'inherit'],
            cwd: out.dir
        });

        const lines = new LineReader(proc.stdout);
        lines.on('line', async (l) => {
            const match = l.match(/^Note: including file: +([^ ](.|\s)+)$/);
            if (match) {
                await dfProm;
                dfProm = new Promise((resolve) => {
                    depfile.write(match[1], resolve);
                });
            } else {
                process.stdout.write(l);
            }
        });

        const depfileDone = new Promise((resolve) => {
            lines.on('end', () => {
                dfProm.then(() => depfile.end());
                resolve();
            })
        });

        await depfileDone;
        return proc;
    }

    archive(opts) {
        const args = [
            '/nologo',
            `/OUT:${opts.outputPath}`,
            ...opts.objects
        ];
        return spawn('lib', args, {
            stdio: 'inherit'
        });
    }

    link(opts) {
        // we pass dll to linker but link to lib. kind of gross
        const outputPath = opts.outputPath.replace(/lib$/i, 'dll');

        const args = [
            '/nologo',
            `/OUT:${outputPath}`,
            ...opts.objects
        ];

        switch (opts.type) {
            case 'executable':
                break;
            case 'dynamicLib':
                args.push('/DLL');
                break;
            default:
                throw new Error(`Unknown image type ${opts.type}`);
                break;
        }

        if (opts.isDebug) {
            args.push('/DEBUG');
        }

        for (const lib of opts.libraries) {
            args.push(lib.path);
        }
        
        return spawn('link', args, {
            stdio: 'inherit'
        });
    }

    *depfileEntries(path) {
        const contents = fs.readFileSync(path, { encoding: 'utf8' });
        const entries = contents.split('\r\n');
        for (const entry of entries) {
            if (entry) {
                yield entry;
            }
        }

        return;
    }

    binaryPackHelpers(lib) {
        const type = lib.type();
        const binary = lib.binary();
        const sys = binary.sys();
        const isDebug = sys.isDebugBuild();

        if (type === 'static') {
            return [];
        } else if (type === 'dynamic') {
            const helpers = [];
            helpers.push(new GeneratedHelper(binary, 'dll'));
            isDebug && helpers.push(new GeneratedHelper(binary, 'pdb'));
            return helpers;
        } else {
            throw new Error(`Unknown library type ${type}`);
        }
    }
}

class GeneratedHelper extends StaticPath {
    #binary;

    constructor(binary, ext) {
        const path = binary.path();
        const generated = path.dir().join(path.basename().replace(/lib$/, ext));
        super(binary.sys(), generated);
        this.#binary = binary;
    }

    deps() {
        return [this.#binary];
    }
}

module.exports = {
    MsvcToolchain
};
