import { fmtElapsedTime } from '../fmtElapsedTime.js';
import { expect } from 'chai';

describe('fmtElapsedTime', () => {
	describe('nanoseconds (< 1us)', () => {
		it('formats zero as 000ns', () => {
			expect(fmtElapsedTime(0)).to.equal('000ns');
		});

		it('formats 500ns', () => {
			expect(fmtElapsedTime(0.0005)).to.equal('500ns');
		});

		it('pads single-digit ns', () => {
			expect(fmtElapsedTime(0.000001)).to.equal('001ns');
		});

		it('formats up to 999ns', () => {
			expect(fmtElapsedTime(0.000999)).to.equal('999ns');
		});
	});

	describe('microseconds (1us to <1ms)', () => {
		it('formats 1us', () => {
			expect(fmtElapsedTime(0.001)).to.equal('001us');
		});

		it('formats 500us', () => {
			expect(fmtElapsedTime(0.5)).to.equal('500us');
		});

		it('formats 999us', () => {
			expect(fmtElapsedTime(0.999)).to.equal('999us');
		});
	});

	describe('milliseconds (1ms to <1s)', () => {
		it('formats 1ms', () => {
			expect(fmtElapsedTime(1)).to.equal('001ms');
		});

		it('formats 500ms', () => {
			expect(fmtElapsedTime(500)).to.equal('500ms');
		});

		it('formats 999ms', () => {
			expect(fmtElapsedTime(999)).to.equal('999ms');
		});
	});

	describe('seconds 1-9 (1s to <10s)', () => {
		it('formats 1.00s', () => {
			expect(fmtElapsedTime(1000)).to.equal('1.00s');
		});

		it('formats 5.00s', () => {
			expect(fmtElapsedTime(5000)).to.equal('5.00s');
		});

		it('formats 9.991s as 9.99s', () => {
			expect(fmtElapsedTime(9991)).to.equal('9.99s');
		});
	});

	describe('seconds 10-59 (10s to <60s)', () => {
		it('formats 10.0s', () => {
			expect(fmtElapsedTime(10000)).to.equal('10.0s');
		});

		it('formats 30.0s', () => {
			expect(fmtElapsedTime(30000)).to.equal('30.0s');
		});

		it('formats 59.901s as 59.9s', () => {
			expect(fmtElapsedTime(59901)).to.equal('59.9s');
		});
	});

	describe('minutes 1-9 (1m to <10m)', () => {
		it('formats 1m00s', () => {
			expect(fmtElapsedTime(60000)).to.equal('1m00s');
		});

		it('formats 5m00s', () => {
			expect(fmtElapsedTime(300000)).to.equal('5m00s');
		});

		it('formats 9m59s', () => {
			expect(fmtElapsedTime(599000)).to.equal('9m59s');
		});

		it('pads single-digit seconds', () => {
			expect(fmtElapsedTime(61000)).to.equal('1m01s');
		});
	});

	describe('minutes 10-59 (10m to <1h)', () => {
		it('formats 10m00s as 10m0s', () => {
			expect(fmtElapsedTime(600000)).to.equal('10m0s');
		});

		it('formats 10m50s as 10m5s', () => {
			expect(fmtElapsedTime(650000)).to.equal('10m5s');
		});

		it('formats 59m59s as 59m5s', () => {
			expect(fmtElapsedTime(3599000)).to.equal('59m5s');
		});

		it('formats 30m30s as 30m3s', () => {
			expect(fmtElapsedTime(1830000)).to.equal('30m3s');
		});
	});

	describe('hours (1h+)', () => {
		it('formats 1h00m', () => {
			expect(fmtElapsedTime(3600000)).to.equal('1h00m');
		});

		it('formats 1h01m', () => {
			expect(fmtElapsedTime(3660000)).to.equal('1h01m');
		});

		it('formats 2h00m', () => {
			expect(fmtElapsedTime(7200000)).to.equal('2h00m');
		});

		it('formats 10h05m', () => {
			expect(fmtElapsedTime(36300000)).to.equal('10h05m');
		});
	});
});
