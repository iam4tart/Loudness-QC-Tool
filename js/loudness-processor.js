class LoudnessProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // memory for stage 1 - high shelf filter
        this.hs = { x1: 0, x2: 0, y1: 0, y2: 0 };
        // memory for stage 2 - high pass filter
        this.hp = { x1: 0, x2: 0, y1: 0, y2: 0 };

        this.buffer_momentary = [];
        this.bufferSize_momentary = null;
        this.samplesSinceLastReport = 0;
        this.buffer_shortterm = [];
        this.bufferSize_shortterm = null;
        this.hopSize = null;
    }

    applyBiquad(x, state, b0, b1, b2, a1, a2) {
        const y = b0 * x + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
        state.x2 = state.x1;
        state.x1 = x;
        state.y2 = state.y1;
        state.y1 = y;
        return y;
    }

    kWeight(x) {
        // stage 1: high shelf - boost highs above ~1.5kHz
        const afterHS = this.applyBiquad(x, this.hs,
            1.53512485958697, -2.69169618940638, 1.19839281085285,
            -1.69065929318241, 0.73248077421585
        );

        // stage 2: high pass - cuts everything below ~38Hz
        const afterHP = this.applyBiquad(afterHS, this.hp,
            1.0, -2.0, 1.0,
            -1.99004745483398, 0.99007225036621
        );

        return afterHP;
    }

    process(inputs, outputs, parameters) { // every 128 samples (~3ms)
        const input = inputs[0][0]; // Float32Array
        if (!input) return true;

        if (this.bufferSize_momentary === null) {
            this.bufferSize_momentary = Math.round(sampleRate * 0.4); // 400ms window for momentary
            this.bufferSize_shortterm = Math.round(sampleRate * 3); // 3000ms window for shortterm
            this.hopSize = Math.round(sampleRate * 0.1);
        }

        for (let i = 0; i < input.length; i++) {
            const weighted = this.kWeight(input[i]);
            this.buffer_momentary.push(Math.pow(weighted, 2));
            this.buffer_shortterm.push(Math.pow(weighted, 2));

            if (this.buffer_momentary.length > this.bufferSize_momentary) {
                this.buffer_momentary.shift();
            }

            if (this.buffer_shortterm.length > this.bufferSize_shortterm) {
                this.buffer_shortterm.shift();
            }

            this.samplesSinceLastReport++;

            if (this.samplesSinceLastReport >= this.hopSize) { // time to hop to new frame
                this.samplesSinceLastReport = 0;

                const meanSquare_momentary = this.buffer_momentary.reduce((a, b) => a + b, 0) / this.buffer_momentary.length;
                const meanSquare_shortterm = this.buffer_shortterm.reduce((a, b) => a + b, 0) / this.buffer_shortterm.length;
                const momentaryLufs = -0.691 + 10 * Math.log10(meanSquare_momentary);
                const shorttermLufs = -0.691 + 10 * Math.log10(meanSquare_shortterm);
                this.port.postMessage({
                    momentary: isFinite(momentaryLufs) ? momentaryLufs : -Infinity,
                    shortTerm: isFinite(shorttermLufs) ? shorttermLufs : -Infinity
                });
            }
        }

        return true;
    }
}

registerProcessor('loudness-processor', LoudnessProcessor);