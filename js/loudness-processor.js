const TRUE_PEAK_FIR = [
    0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000,
   -0.0594482421875, 0.1373291015625,  0.9833984375000, 0.1373291015625,
   -0.0594482421875, 0.0332031250000, -0.0196533203125, 0.0109863281250,
    0.0017089843750
];

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
        this.integratedBlocks = [];
        this.truePeakBuffer = new Float32Array(TRUE_PEAK_FIR.length).fill(0);
        this.truePeakMax = 0;

        this.port.onmessage = (e) => {
            if (e.data.command === "getIntegrated") {
                const integrated = this.calculateIntegrated();
                const dbTP = 20 * Math.log10(this.truePeak);
                this.port.postMessage({ 
                    integrated: isFinite(integrated) ? integrated : -Infinity,
                    truePeak: isFinite(dbTP) ? dbTP : -Infinity
                });
            }
        };
    }

    calculateIntegrated() {
        if(this.integratedBlocks.length === 0) return -Infinity;

        // absolute gate to remove blocks below -70 LUFS
        const absoluteGated = this.integratedBlocks.filter(ms => {
            const lufs = -0.691 + 10 * Math.log10(ms);
            return lufs > -70;
        });
        if(absoluteGated.length === 0) return -Infinity;

        // ungated average
        const ungatedMean = absoluteGated.reduce((a,b) => a+b, 0) / absoluteGated.length;
        const ungatedLufs = -0.691 + 10 * Math.log10(ungatedMean);

        // relative gate to remove blocks below (ungated-10) LUFS
        const relativeThreshold = ungatedLufs - 10;
        const relativeGated = absoluteGated.filter(ms => {
            const lufs = -0.691 + 10 * Math.log10(ms);
            return lufs > relativeThreshold;
        });
        if (relativeGated.length === 0) return -Infinity;

        // final integrated LUFS
        const finalMean = relativeGated.reduce((a,b) => a+b, 0) / relativeGated.length;
        return -0.691 + 10 * Math.log10(finalMean);
    }

    processTruePeak(sample) {
        // shift buffer
        for(let i=this.truePeakBuffer.length-1; i>0; i--) {
            this.truePeakBuffer[i] = this.truePeakBuffer[i-1];
        }
        this.truePeakBuffer[0] = sample;

        // convolve with FIR - this gives one interpolated peak estimate
        let peak = 0;
        for(let i=0; i<TRUE_PEAK_FIR.length; i++) {
            peak += TRUE_PEAK_FIR[i] * this.truePeakBuffer[i];
        }

        const absPeak = Math.abs(peak);
        if(absPeak > this.truePeakMax) {
            this.truePeakMax = absPeak;
        }
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
            this.processTruePeak(input[i]);
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
                this.integratedBlocks.push(meanSquare_momentary);
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