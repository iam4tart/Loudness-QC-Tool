const TRUE_PEAK_PHASES = [
    // phase 1 - t=0.25
    [
        0.0000000000, -0.0001700000,  0.0005500000, -0.0012800000,
        0.0024900000, -0.0043100000,  0.0068300000, -0.0100600000,
        0.0138900000, -0.0184200000,  0.0238400000, -0.0304300000,
        0.0385700000, -0.0490100000,  0.0630100000, -0.0840100000,
        0.1200500000,  0.7830100000,  0.2531700000, -0.1014500000,
        0.0541700000, -0.0316700000,  0.0193800000, -0.0119600000,
        0.0072100000, -0.0041800000,  0.0022800000, -0.0011300000,
        0.0004900000, -0.0001700000,  0.0000400000
    ],
    // phase 2 - t=0.50
    [
        0.0000000000, -0.0002500000,  0.0007900000, -0.0018000000,
        0.0034300000, -0.0057800000,  0.0089300000, -0.0128400000,
        0.0173100000, -0.0223400000,  0.0279300000, -0.0341400000,
        0.0411400000, -0.0492300000,  0.0590600000, -0.0714400000,
        0.0885600000,  0.5859400000,  0.5859400000, -0.0885600000,
        0.0714400000, -0.0590600000,  0.0492300000, -0.0411400000,
        0.0341400000, -0.0279300000,  0.0223400000, -0.0173100000,
        0.0128400000, -0.0089300000,  0.0057800000
    ],
    // phase 3 - t=0.75
    [
        0.0000400000, -0.0001700000,  0.0004900000, -0.0011300000,
        0.0022800000, -0.0041800000,  0.0072100000, -0.0119600000,
        0.0193800000, -0.0316700000,  0.0541700000, -0.1014500000,
        0.2531700000,  0.7830100000,  0.1200500000, -0.0840100000,
        0.0630100000, -0.0490100000,  0.0385700000, -0.0304300000,
        0.0238400000, -0.0184200000,  0.0138900000, -0.0100600000,
        0.0068300000, -0.0043100000,  0.0024900000, -0.0012800000,
        0.0005500000, -0.0001700000,  0.0000000000
    ]
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
        this.truePeakBuffer = new Float32Array(31).fill(0);
        this.truePeakMax = 0;

        this.port.onmessage = (e) => {
            if (e.data.command === "getIntegrated") {
                const integrated = this.calculateIntegrated();
                this.port.postMessage({ 
                    integrated: isFinite(integrated) ? integrated : -Infinity
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

        // consder the real sample itself as candidate peak
        const realPeak = Math.abs(sample);
        let maxThisSample = realPeak;

        for(let phase=0; phase<3; phase++) {
            let sum=0;
            for(let i=0; i<31; i++) {
                sum += TRUE_PEAK_PHASES[phase][i] * this.truePeakBuffer[i];
            }
            const absPeak = Math.abs(sum);
            if(absPeak > maxThisSample) maxThisSample = absPeak;
        }

        if(maxThisSample > this.truePeakMax) {
            this.truePeakMax = maxThisSample;
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
                const currentDbTP = 20 * Math.log10(this.truePeakMax);
                this.port.postMessage({
                    momentary: isFinite(momentaryLufs) ? momentaryLufs : -Infinity,
                    shortTerm: isFinite(shorttermLufs) ? shorttermLufs : -Infinity,
                    truePeak: isFinite(currentDbTP) ? currentDbTP : -Infinity
                });
            }
        }

        return true;
    }
}

registerProcessor('loudness-processor', LoudnessProcessor);