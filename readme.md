![Loudness Meter Tool Preview](assets/images/preview.png)

POLISH: problem -> solution -> tech stack -> thinking pointers -> i should keep text lowercase

[x] HTML button
[x] JS toggle
[x] Microphone access
[x] Audio capture
[x] Capture chunks
[x] K-weighting filter
[x] Loudness calculation
[x] Real-time display
[x] Integrated loudness
[x] True Peak
[x] Styling
[-] Deploy

technically, audio heavy dsp tooling should be done in C++ for faster computation and with WASM compiled for JS, but loudness meter is not technically heavy therefore directly using webaudio api with audioworklet works here.

promise is a object representing a future value(async operation).
having states like pending, fulfilled, rejected. Used for non-blocking operations like API Calls, file reading, microphone access, etc

restaurant analogy to understand non-blocking operation -
sync => you order, stand at counter, wait, block line behind you
promise(async) => you order, get pages, sit down, line moves, food ready, pager buzzes, you eat
pages = you do other things while waiting

for microphone access - we do by utilizing GetUserMedia function promise, as javascript is single threaded, promises prevent blocking, microphone access takes time-promise and lets other code run while watching. without it, browser freezes

navigator in web api is the global object representing browser info and capabilities

audio capture is done by creating audio context which is the audio-processing graph built from audio modules linked together and then plugging in mic media stream using CreateMediaStreamSource function

postMesage is a thread-safe queue between main thread of JS and audio thread of audio worklet, in actual browser creates a real OS thread in C++, and js script code runs there via V8 or similar and JS never gets blocked.

browser decides the chunking rate of audio input based on sampleRate usually 44100Hz or 48000Hz
AudioWorklet calls process() with exactly 128 samples every time.
128 samples at 48kHz = 2.67ms between calls
128 samples at 44.1kHz = 2.90ms between calls

browser delivers mic data and webaudio processes in 128-sample blocks, mic has a fixed clock (crystal oscillator)

k-weighting filter is basically a frequency weighting method used in acoustics to measure perceived loudness of sounds. It has ability to accurately predict human loudness perception. Because human ear response is non-linear usually giving more weight to higher frquencies

k-weighting filter applies two filters in series ->
stage 1 - high shelf filter (pre-filter) - boosts frequencies above ~1.5kHz by ~4dB
stage 2 - high pass filter (RLB weighting) - rolls off everything below ~38Hz (removing sub-bass)

each filter is biquad filter. the coefficients (b0,b1,b2,a1,a2) for each filter are fixed constants derived from the ITU-bs.1770 spec - they differ depending on your sample rate (48kHz or 44.1kHz)

mean squaring ->
squaring makes everything positive and amplifies louder sounds more than the quiet ones (matches perception)
mean the squares over a sliding window of 400ms every 100ms (75% overlap), this gives "momentary loudness" reading 10 times per second.
in dsp, 50% or more overlap is considered a good balance between time resolution and frequency resolution, helping to minimize artifacts and more accurate representations of rapidly changing signals.
short term loudness is similarly to momentary loudness in all aspects except the window size which is 3000ms (3s averages)

mean_square = sum(sample**2 for each sample in window) / num_samples
to convert to lufs -> LUFS = -0.691 + 10 x log10(mean_square)
the constant -0.691 from the spec calibrates the scale.
LUFS = 0 is the absolute maximum
normal speech/music lives around -23 to -14 LUFS

momentary loudness changes every 100ms, integrated loudness is the average over the entire program
ITU also adds 2 gating stages to ignore silence (pauses between words shouldn't drag the average down)

gate 1 - absolute gate: ignore any 400ms block below -70 LUFS, therefore pure silence is excluded
gate 2 - relative gate:
    1. calculate un-gated average first (ex. -18LUFs)
    2. set threshold = un-gated average - 10 LU (ex. -18-10 = -28LUFs)
    3. re-calculate average using only blocks above that threshold (ex. block stream [-16, -17, -18, -50, -51, -17, -16], throw away -50 and -51 which is below -28LUFs)

transfer function is a mathematical representation that describes how a system responds to an input signal, typically expressed in the z-domain. we use it to analyze and design filters by relating the input and output signals through a ratio of polynomials.

biquad filter's difference equation:
    y[n] = b0·x[n] + b1·x[n-1] + b2·x[n-2] - a1·y[n-1] - a2·[n-2]
where,
    x = input samples (history)
    y = output samples (history) 

sample rate decides the buffer size and hop size because depending on how fast the hardware is clocking within the same time duration, different number of samples are fired.

bufferSize = sampleRate * 0.4
// 48000 * 0.4 = 19200 samples = 400ms
// 44100 * 0.4 = 17640 samples = 400ms

hopSize = sampleRate * 0.1
// 48000 * 0.1 = 4800 samples = 100ms
// 44100 * 0.1 = 4410 samples = 100ms

Also, don't forget signal processing domain usually work with floats more than doubles and int

samplesSinceLastReport variable helps count samples because inside process() which runs at 2.67ms(128 samples), we have no clock and we have to send lufs update every 100ms

for the realtime display - audioworklet is running on separate thread calling process() every 128 samples while the ui is on the main thread, these can't share memory directly.

requestAnimationFrame - browser API that calls function right before the browser repaints the screen, ~60 times per second (every 16ms)

now, when metering visuals are made, question is to either choose a logarithmic display or linear display, LUFS is logarithmic unit.
dB is general ratio. It just means 10*log10 of some ratio, it has no absolute reference point on its own.
LUFS is dB applied with kweighting and referenced to full-scale - meaning 0 LUFS is the absolute maximum a digital system can represent.

so we are using linear dB scale for visual metering as
-60 to 0 LUFS spread evenly = linear scale
but since LUFS is already log, this is perceptually correct

metering is pretty straightforward for example 
currentLufs = -18 LUFS
range = -60 to 0 = 60 units in total
calc = -18 - (-60) = 42 units from bottom
42/60*100 = draw 70% height
every 100ms the worklet sends a LUFS value.

range = MAX_LUFS - MIN_LUFS = 0 - (-60) = 60
(clamped - MIN_LUFS) = distance from the bottom
distance/60 = what fraction of the way up you are
multiply by 100 = percentage

visual meter bar grows from bottom so height of bar is calculated from bottom
while scale marks on the meter are positioned from the top
typically, label sits exactly where the bar would reach at that loudness level
top: 0% - height: 100% -> 0 LUFS
top: 3% - height: 70% -> 0 LUFS
top: 100% - height: 0% -> 0 LUFS

2 separate buffers run in parallel - one for momentary and one for short term.
each with own buffer, buffersize and samplessincelastreport
the k-weighted sample gets pushed into both buffers every teration and they share same filter input but accumulate independently

integratedBlocks is non-limit, it grows forever. at 100ms per block, 1 hour of audio = 36,000 blocks ~= 288KB of memory.
fine for browser usecase, production meters use a running sum instead of storing every block.

a question - how does the code handle aliased peaks in the audio if the blocks are discard while handling integrated Loudness, and it doesn't and that's fine because we are not trying to catch peaks but average perceived loudness over time. a single loud transient lasts maybe 5-10ms, so that transient gets averaged into the block and its energy contribution is tiny.
and this question understanding also somehow leads down to true peak which is separate measurement that handles inter-sample peaks.
integrated LUFS  → how loud was the whole program on average (perceived energy over time)
true peak dBTP   → what was the highest point the waveform ever reached (instantaneous maximum)

streaming platforms convert digital audio to analog during playback, if the real waveform between sample exceeds 0dbFS (1.0 amplitude), you get distortion. This is called Inter-sample clipping.

so lets say mic captures audio 48000 times per second, each capture is a number between -1.0 and 1.0, that's a sample

time:    0ms      0.02ms   0.04ms
sample:  0.3      0.7      0.4

between those captures, the real world audio is continuous, the actual waveform between sample 1 and sample 2 could go higher than both

real waveform:
        0.3 → rises to 0.95 → falls to 0.7
               ↑ never saw this

so to see between samples, we create new fake samples between the real ones, this is called oversampling. at 4x oversampling you insert 3 new samples between each real one.

original (1x):  [0.3,  0.7]
4x oversample:  [0.3,  0.52, 0.78, 0.95, 0.7]
                        ↑ these are interpolated
now, peak that was hiding between original samples is nearly visible

another question is how to interpolate correctly?
not by averaging - that's too limiting
we use FIR filter (Finite Impulse Response), it's a set of fixed coefficients

TRUE_PEAK_FIR is short FIR filter with 13 coefficients AKA taps, more taps = more accurate interpolation but more computation per sample. 13 taps is enough for accurate inter-sample peak detection. 
ITU-BS.1770 specifies the exact FIR coefficients to use for 4x oversampling. They're long — 48 coefficients — but you apply them once and get accurate inter-sample peaks.
more coefficients = longer filter = more accurate reconstruction of the waveform between samples

true peak buffer is a sliding window of the last raw samples.
new sample arrives → shift everything right → put new sample at index 0
[new, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12]
then convolve with FIR coefficients = one interpolated peak value
convolve: new_sample = sum(original_samples[i] * fir_coefficients[i])

after oversampling, track the maximum absolute value seen accross the entire recording session as we care about magnitude not direction
'truePeakMax' starts at 0, only ever goes up, never comes down

3 phase + real samples = checks 4 points per sample instead of 1 (true 4x oversampling)
more points between samples = less chance of missing the actual peak
ex-
real t=0.00: [0.3,   0.95,  0.4]
phase 1 t=0.25: [0.61,  0.89,  0.55]
phase 2 t=0.50: [0.71,  0.98,  0.61]
phase 3 t=0.75: [0.85,  0.94,  0.48]

some mathematics of how power and amplitude are related:
power = amplitude ** 2
log10(amplitude ** 2) = 2 * log10(amplitude)
so,
db = 10*log10(power)
db = 10 * 2 * log10(amplitude)

db is generally a ratio between 2 values
dBFS measures individual samples. Maximum sample = 0 dBFS. By definition nothing exceeds 0 dBFS in the digital domain
dbTP measures the reconstructed analog waveform after oversampling. that reconstructed waveform CAN exceed 1.0 amplitude even when no individual sample did. (that is clipping in analog when over 1.0) and dbTP CAN be positive

reasoning: streaming platforms found that millions of tracks that measured fine digitally were causing distortion on consumer playback hardware. the hardware DACs (digital to analog converters) were clipping on inter-sample peaks. so they mandated -1 dbTP maximum to leave headroom for the reconstruction. the problem is not digital but digital to analog conversion.

edit: i have updated to more coefficients for true 4x oversampling as outlines by ITU standard

delay calculation for full chain:

AUDIO INPUT
    ↓
128 samples arrive every 2.67ms <- hardware clock, non-negotiable
    ↓
process() runs, samples get K-weighted and pushed into buffer
time cost: ~0.1ms (just math)
    ↓
buffer fills up to 400ms worth of samples
BUGGEST DELAY - averaging over 400ms by spec
    ↓
every 100ms (hopSize), LUFS is calculated and postMessage fires
so wait is upto 100ms for the next report
    ↓
message crosses the thread boundary
time cost: ~0.1ms
    ↓
currentLufs variable is updated
    ↓
rAF picks it up on the next tick
wait: 0-16ms
    ↓
DOM updates, number updates are seen

TOTAL WORST CASE:   ~517ms
TOTAL AVERAGE:      ~450ms

Also, humans can't perceive display lag under ~100ms

Sources used:
[Get Microphone Permission](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Build_a_phone_with_peerjs/Connect_peers/Get_microphone_permission)
[GetUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
[CreateMediaStreamSource()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamSource)
[Audio Worklet Design Pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern/)
[Basic K-weighting](https://www.numberanalytics.com/blog/mastering-k-weighting-acoustics)
[Papers of ITU bs.1770 standards](https://www.itu.int/rec/R-REC-BS.1770)
[Audio EQ Cookbook](https://webaudio.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html)
[Transfer Function Analysis](https://www.dsprelated.com/freebooks/filters/Transfer_Function_Analysis.html)
[requestAnimationFrame()](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
[High level overview of loudness (little old)](https://www.production-expert.com/production-expert-1/loudness-everything-you-need-to-know)

managing start and stop and start for averaging lufs
improvements:
VU meter behaviour more accurate - bar should fall slower than it rises
peak hold for atleast 2s

