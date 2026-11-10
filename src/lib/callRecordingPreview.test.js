const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  CALL_RECORDING_PREVIEW_NOTE,
  SAMPLE_AUDIO_URL,
  sampleCallRecording,
} = require('./callRecordingPreview');
const { render } = require('../../public/callRecordingCard');

function testSampleShape() {
  const sample = sampleCallRecording();
  assert.strictEqual(sample.available, true);
  assert.strictEqual(sample.preview, true);
  assert.strictEqual(sample.sample, true);
  assert.strictEqual(sample.liveCapture, false);
  assert.strictEqual(sample.label, 'Call recording (preview - sample)');
  assert.strictEqual(sample.note, CALL_RECORDING_PREVIEW_NOTE);
  assert.ok(sample.note.includes('Agora'));
  assert.ok(sample.note.includes('Whisper'));
  assert.ok(sample.note.includes('S3'));
  assert.strictEqual(sample.audioUrl, SAMPLE_AUDIO_URL);
  assert.deepStrictEqual(sample.participants, ['Sarah Chen', 'Rohan Mehta']);
  assert.strictEqual(sample.recordings, undefined);

  const flagged = sample.lines.filter((line) => line.flagged);
  assert.ok(flagged.length >= 2 && flagged.length <= 3);
  assert.ok(flagged.some((line) => /scope agreement/i.test(line.flag)));
  assert.ok(flagged.some((line) => /deadline promise/i.test(line.flag)));
  for (const line of sample.lines) {
    assert.match(line.at, /^\d+:\d{2}$/);
    assert.ok(line.speaker === 'Sarah' || line.speaker === 'Rohan');
    assert.ok(line.text.length > 8);
  }

  const copy = sampleCallRecording();
  copy.lines[0].text = 'mutated';
  assert.notStrictEqual(sampleCallRecording().lines[0].text, 'mutated');
}

function testAudioFile() {
  const file = path.join(__dirname, '../../public/call-recording-sample.mp3');
  const buf = fs.readFileSync(file);
  assert.ok(buf.length > 1000);
  assert.ok(buf.length < 300 * 1024, `sample audio is ${buf.length} bytes`);
  assert.strictEqual(buf.slice(0, 3).toString('ascii'), 'ID3');
}

function testRender() {
  const html = render(sampleCallRecording());
  assert.ok(html.includes('Call recording (preview - sample)'));
  assert.ok(html.includes('<audio'));
  assert.ok(html.includes('controls'));
  assert.ok(html.includes('src="/call-recording-sample.mp3"'));
  assert.ok(html.includes(CALL_RECORDING_PREVIEW_NOTE));
  assert.strictEqual((html.match(/class="flagged"/g) || []).length, 3);
  assert.strictEqual((html.match(/AI-flagged/g) || []).length, 3);
  assert.strictEqual(html.includes('<button'), false);
  assert.strictEqual(html.includes('coming soon'), false);
}

function testRenderEscapes() {
  const html = render({
    label: '<script>label</script>',
    note: '<img src=x onerror=alert(1)>',
    audioUrl: 'javascript:alert(1)',
    lines: [
      {
        at: '0:00',
        speaker: '<Sarah>',
        text: '<script>alert(1)</script>',
        flagged: true,
        flag: '<b>',
      },
    ],
  });
  assert.strictEqual(html.includes('<script'), false);
  assert.strictEqual(html.includes('<img'), false);
  assert.strictEqual(html.includes('javascript:'), false);
  assert.ok(html.includes('src="/call-recording-sample.mp3"'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;Sarah&gt;'));
}

function run() {
  testSampleShape();
  testAudioFile();
  testRender();
  testRenderEscapes();
  console.log('call recording preview tests passed');
}

run();
