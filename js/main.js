'use strict'

let target_note
let score, scores

let sum_counter = 0
let s

// TODO change me
const test_time = 20


document.addEventListener('DOMContentLoaded', () => {
    init_score()

    // init scene
    const saved = localStorage.getItem("username")
    const userinput = document.querySelector('#scene-init input')

    if (saved !== null) {
        userinput.value = saved
    }

    // select scene
    for (const n of document.querySelectorAll('#scene-select li')) {
        n.addEventListener('click', e => {
            document.querySelector('.now-playing').removeAttribute('class')
            e.currentTarget.setAttribute('class', 'now-playing')
            switch_target_notes(e.currentTarget)
            switch_scene('main')
            init_score()
        })
    }

    const btn_select = document.querySelector('#btn-select')
    btn_select.addEventListener('click', () => {
        switch_scene('select')
    })

    const btn_tuner = document.querySelector('#btn-tuner')
    btn_tuner.addEventListener('click', () => {
        switch_scene('tuner')
    })

    const btn_main = document.querySelector('#btn-main')
    btn_main.addEventListener('click', () => {
        switch_scene('main')
        init_score()
    })

    // to main scene
    const btn_start = document.querySelector('#btn-start')
    btn_start.addEventListener('click', () => {
        const username = (() => {
            if (userinput.value === '') {
                return '名無し'
            }
            return userinput.value
        })()

        document.querySelector('#username').innerText = username
        localStorage.setItem('username', username)

        switch_scene('select')
        initialize()
    })

    function init_score() {
        score = 0
        scores = { 'prev-prev': -1, 'prev': -1, 'now': -1 }
        sum_counter = 0
        document.getElementById('score-main').textContent = '0'
        document.getElementById('score-sub').textContent = '.000'
        document.getElementById('score-prev').textContent = '---.---'
        document.getElementById('score-prev-prev').textContent = '---.---'
    }

    function switch_scene(name) {
        for (const scene of document.querySelectorAll('.scene')) {
            scene.style.display = 'none'
        }

        document.querySelector(`#scene-${name}`).style.display = 'block'
    }

    function switch_target_notes(selectedElm) {
        const [note_ja, note_en] = selectedElm.innerText.split('\n')
        target_note = note_ja

        document.getElementById('note-name').textContent = note_ja
        document.getElementById('note-name-en').textContent = note_en
    }
})

const correlation_worker = new Worker('./js/correlation_worker.js')
correlation_worker.addEventListener('message', interpret_correlation_result)

let test_frequencies = []

async function initialize() {
    const G3 = 195.998
    const notes = ['ソ', 'ソ#', 'ラ', 'ラ#', 'シ', 'ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#']
    const notes_en = ['G', 'G#', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#']
    for (let i = 0; i < 36; i++) {
        const note_frequency = G3 * Math.pow(2, i / 12)
        const note_name = notes[i % 12]
        const note_name_en = notes_en[i % 12]

        const note = { 'frequency': note_frequency, 'name': note_name, 'name_en': note_name_en, 'deduction': -1 }
        const just_above = { 'frequency': note_frequency * Math.pow(2, 1 / 48), 'name': note_name, 'name_en': note_name_en, 'deduction': 0 }
        const just_below = { 'frequency': note_frequency * Math.pow(2, -1 / 48), 'name': note_name, 'name_en': note_name_en, 'deduction': -1 }
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
    const confidence_threshold = 60
    const dominant_frequency = test_frequencies[maximum_index]

    // TODO receive target note name and check
    // TODO consider gap true/false to deduction
    // TODO workerize this and call when button pushed
    // TODO how should I consider frequency value?(e.g. A1,A2,A3...)

    s = (confidence > confidence_threshold ? confidence_threshold : confidence) / confidence_threshold
    if (dominant_frequency.name === target_note) {
        score += s
    } else {
        score += s * 0.3
    }

    document.querySelector('#scene-tuner').style.borderColor = 'rgba(0, 0, 0, 0.9)'
    document.querySelector('#tuner-note').style.color = '#fff'
    document.querySelector('#tuner-confidence').style.color = '#aaa'
    if (confidence > 30) {
        document.querySelector('#tuner-note').innerText = dominant_frequency.name
        document.querySelector('#tuner-confidence').innerText = `${Math.round(confidence * 1000) / 1000}%`

        if (confidence > 60) {
            document.querySelector('#scene-tuner').style.borderColor = 'rgba(61, 161, 117, 0.9)'
        }
    } else {
        document.querySelector('#tuner-note').style.color = '#444'
        document.querySelector('#tuner-confidence').style.color = '#666'
    }

    if (++sum_counter === test_time) {
        score /= test_time

        console.log(scores)

        const score_int = Math.round(score * 100 * 1000) / 1000
        if (scores['prev'] != -1) {
            scores['prev-prev'] = scores['prev']
            document.getElementById('score-prev-prev').textContent = scores['prev-prev']
        }
        if (scores['now'] != -1) {
            scores['prev'] = scores['now']
            document.getElementById('score-prev').textContent = parseFloat(
                `${document.getElementById('score-main').textContent}${document.getElementById('score-sub').textContent}`
            )
        }
        scores['now'] = score_int


        const score_str = String(score_int)
        const score_main = score_str.split('.')[0]
        const score_sub = (score_str.indexOf('.') === -1) ? '.000' : `.${score_str.split('.')[1]}`

        document.getElementById('score-main').textContent = score_main
        document.getElementById('score-sub').textContent = score_sub
        sum_counter = 0
        score = 0
    }
}


