import { expect } from 'chai';
import { InMemoryLoggerProvider } from '../InMemoryLoggerProvider.js';
import { Logger, LogLevel } from '../logs.js';

describe('InMemoryLoggerProvider', () => {
	let iml: InMemoryLoggerProvider;
	let l: Logger;
	beforeEach(() => {
		iml = new InMemoryLoggerProvider();
		l = iml.getLogger({ name: 'InMemoryLoggerProviderSpec' });
	});

	describe('logs', () => {
		it('contains the ordered list of emitted log records', async () => {
			l.error('error');
			l.warn('warn');
			expect(iml.logs.length).to.equal(2);
			expect(iml.logs[0].body).to.equal('error');
			expect(iml.logs[1].body).to.equal('warn');
		});
	});

	describe('clear', () => {
		it('resets the logs to be empty', () => {
			l.error('error');
			expect(iml.logs).not.to.be.empty;

			iml.clear();
			expect(iml.logs).to.be.empty;
		});
	});

	describe('find', () => {
		beforeEach(() => {
			l.info('first log');
			l.warn('second log');
			l.warn('third log');
		});

		it('returns null when level does not match any', () => {
			const l = iml.find(LogLevel.error, /.*/);
			expect(l).to.be.null;
		});

		it('returns null when pattern does not match any', () => {
			const l = iml.find(LogLevel.info, /fourth/);
			expect(l).to.be.null;
		});

		it('returns first match only', () => {
			const l = iml.find(LogLevel.warn, /.* log/);
			expect(l.body).to.equal('second log');
		});

		it('accepts a string pattern', () => {
			const l = iml.find(LogLevel.warn, '.* log');
			expect(l.body).to.equal('second log');
		});
	});

	describe('findEvents', () => {
		beforeEach(() => {
			l.error({ eventName: 'a', body: 'a1' });
			l.info({ eventName: 'b', body: 'b1' });
			l.debug({ eventName: 'a', body: 'a2' });
		});

		it('returns an empty array when nothing matches', () => {
			const evts = iml.findEvents('c');
			expect(evts).to.be.empty;
		});

		it('returns all events in order matching event name', () => {
			const evts = iml.findEvents('a');
			expect(evts.length).to.equal(2);
			expect(evts[0].body).to.equal('a1');
			expect(evts[1].body).to.equal('a2');
		});
	});
});
