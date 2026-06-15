const ms_1us = 0.001;
const ms_1s = 1000;
const ms_1m = 60 * ms_1s;
const ms_1h = 60 * ms_1m;

export function fmtElapsedTime(elapsedMs: number): string {
	if (elapsedMs < ms_1us) {
		const ns = Math.floor(elapsedMs * 1e6);
		return `${String(ns).padStart(3, '0')}ns`;
	} else if (elapsedMs < 1) {
		const us = Math.floor(elapsedMs * 1e3);
		return `${String(us).padStart(3, '0')}us`;
	} else if (elapsedMs < ms_1s) {
		const ms = Math.floor(elapsedMs);
		return `${String(ms).padStart(3, '0')}ms`;
	} else if (elapsedMs < ms_1m) {
		const sec = elapsedMs / ms_1s;
		return `${sec.toPrecision(3)}s`;
	} else if (elapsedMs < 10 * ms_1m) {
		const totalSec = Math.floor(elapsedMs / ms_1s);
		const min = Math.floor(totalSec / 60);
		const sec = totalSec % 60;
		return `${min}m${String(sec).padStart(2, '0')}s`;
	} else if (elapsedMs < ms_1h) {
		const totalSec = Math.floor(elapsedMs / ms_1s);
		const min = Math.floor(totalSec / 60);
		const sec = totalSec % 60;
		return `${min}m${Math.floor(sec / 10)}s`;
	} else {
		const totalMin = Math.floor(elapsedMs / ms_1m);
		const hr = Math.floor(totalMin / 60);
		const min = totalMin % 60;
		return `${hr}h${String(min).padStart(2, '0')}m`;
	}
}
