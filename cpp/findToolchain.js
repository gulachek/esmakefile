function findToolchain(os) {
	const platform = os.platform();
	if (platform === 'win32') {
		const { MsvcToolchain } = require('./toolchains/msvcToolchain');
		return new MsvcToolchain();
	} else if (platform === 'darwin') {
		const { ClangToolchain } = require('./toolchains/clangToolchain');
		return new ClangToolchain();
	} else if (platform === 'linux') {
		const { GccToolchain } = require('./toolchains/gccToolchain');
		return new GccToolchain();
	} else {
		throw new Error(`No toolchain defined for platform '${platform}'`);
	}
}

module.exports = { findToolchain };
