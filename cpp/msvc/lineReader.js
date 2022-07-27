const EventEmitter = require('events');

class LineReader extends EventEmitter {
    #stream;
    #buffer;

    constructor(stream) {
        super();
        this.#stream = stream;
        this.#buffer = [];
        this.#stream.setEncoding('utf8');
        this.#stream.on('data', this.#onData.bind(this));
        this.#stream.on('end', this.#onEnd.bind(this));
    }

    #onData(data) {
        let pos = 0;
        let lf = data.indexOf('\n');
        while (lf !== -1) {
            this.#buffer.push(data.slice(pos, lf + 1));
            this.#dump();
            pos = lf + 1;
            lf = data.indexOf('\n', pos);
        }

        if (pos < data.length) {
            this.#buffer.push(data.slice(pos));
        }
    }

    #onEnd(e) {
        this.#dump();
        this.emit('end');
    }

    #dump() {
        if (this.#buffer.length < 1) { return; }
        const line = this.#buffer.join('');
        this.emit('line', line);
        this.#buffer = [];
    }
}

module.exports = {
    LineReader
};