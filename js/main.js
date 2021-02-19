'use strict'

let test_frequencies = []

window.addEventListener('load', initialize)

const correlation_worker = new Worker('./js/correlation_worker.js')
correlation_worker.addEventListener('message', interpret_correlation_result)

async function initialize() {
    const G3 = 195.998
    const notes = ['ソ', 'ソ#', 'ラ', 'ラ#', 'シ', 'ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#']
    const notes_en = ['G', 'G#', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#']
    for (let i = 0; i < 36; i++) {
        const note_frequency = G3 * Math.pow(2, i / 12)
        const note_name = notes[i % 12]
        const note_name_en = notes_en[i % 12]

        const note = { 'frequency': note_frequency, 'name': note_name, 'name_en': note_name_en, 'gap': false }
        const just_above = { 'frequency': note_frequency * Math.pow(2, 1 / 48), 'name': note_name, 'name_en': note_name_en, 'gap': true }
        const just_below = { 'frequency': note_frequency * Math.pow(2, -1 / 48), 'name': note_name, 'name_en': note_name_en, 'gap': true }
        test_frequencies = test_frequencies.concat([just_below, note, just_above])
        console.log(test_frequencies)
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    use_stream(stream)
}

function use_stream(stream) {
    const audio_context = new (window.AudioContext || window.webkitAudioContext)()
    const microphone = audio_context.createMediaStreamSource(stream)
    const script_processor = audio_context.createScriptProcessor(1024, 1, 1)

    script_processor.connect(audio_context.destination)
    microphone.connect(script_processor)

    const sample_length_milliseconds = 100
    let buffer = []
    let recording = true

    window.capture_audio = function(event) {
        if (!recording) {
            return
        }

        buffer = buffer.concat(Array.prototype.slice.call(event.inputBuffer.getChannelData(0)))

        // Stop recording after sample_length_milliseconds.
        if (buffer.length > sample_length_milliseconds * audio_context.sampleRate / 1000) {
            recording = false

            correlation_worker.postMessage({
                'timeseries': buffer,
                'test_frequencies': test_frequencies,
                'sample_rate': audio_context.sampleRate
            })
            buffer = []
            setTimeout(() => { recording = true }, 250)
        }
    }

    script_processor.onaudioprocess = window.capture_audio
}

let score = 0
let sum_counter = 0
function interpret_correlation_result(event) {
    const frequency_amplitudes = event.data.frequency_amplitudes

    // Compute the (squared) magnitudes of the complex amplitudes for each
    // test frequency.
    const magnitudes = frequency_amplitudes.map(z => z[0] * z[0] + z[1] * z[1])

    // Find the maximum in the list of magnitudes.
    let maximum_index = -1
    let maximum_magnitude = 0
    for (let i = 0; i < magnitudes.length; i++) {
        if (magnitudes[i] <= maximum_magnitude) {
            continue
        }

        maximum_index = i
        maximum_magnitude = magnitudes[i]
    }

    // Compute the average magnitude. We'll only pay attention to frequencies
    // with magnitudes significantly above average.
    const average = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length
    const confidence = maximum_magnitude / average
    const confidence_threshold = 30
    const dominant_frequency = test_frequencies[maximum_index]
    if (confidence > confidence_threshold) {
        document.getElementById('note-name').textContent = `${dominant_frequency.name}(${dominant_frequency.name_en})`
    } else {
        document.getElementById('note-name').textContent = '(˘ω˘)'
    }

    // TODO receive target note name and check
    // TODO consider gap true/false to deduction
    // TODO workerize this and call when button pushed
    // TODO how should I consider frequency value?(e.g. A1,A2,A3...)
    // TODO sum_counter 40 means 10sec. change this more flexible

    score += (confidence > 60 ? 60 : confidence) / 60
    if (++sum_counter === 40) {
        score /= 40

        const score_str = String(Math.round(score * 100 * 1000) / 1000)
        document.getElementById('score-main').textContent = score_str.split('.')[0]
        document.getElementById('score-sub').textContent = `.${score_str.split('.')[1]}`
        sum_counter = 0
        score = 0
    }
}
