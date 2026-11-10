/**
 * Sample call shown on every counselor dispute.
 * Live Agora capture, Whisper, and S3 stay on the roadmap — this object is preview data only.
 */

const CALL_RECORDING_PREVIEW_NOTE =
  'Preview with sample data. Live Agora calls, Whisper transcripts and S3 storage are on the roadmap.';

const SAMPLE_AUDIO_URL = '/call-recording-sample.mp3';

const SAMPLE_LINES = Object.freeze([
  Object.freeze({
    at: '0:00',
    speaker: 'Sarah',
    text: 'The scope we agreed is the hero CTA, the login form, and the session cookie.',
    flagged: true,
    flag: 'Scope agreement',
  }),
  Object.freeze({
    at: '0:05',
    speaker: 'Rohan',
    text: 'Agreed. I will ship the login form and the session cookie before Friday.',
    flagged: true,
    flag: 'Deadline promise',
  }),
  Object.freeze({
    at: '0:10',
    speaker: 'Sarah',
    text: 'Friday is the deadline. If the cookie is missing, I will not sign off.',
    flagged: true,
    flag: 'Sign-off condition',
  }),
  Object.freeze({
    at: '0:14',
    speaker: 'Rohan',
    text: 'The hero CTA is already in. Login and the cookie by Friday.',
    flagged: false,
    flag: '',
  }),
  Object.freeze({
    at: '0:19',
    speaker: 'Sarah',
    text: 'I will raise a dispute only if Friday passes without the cookie.',
    flagged: false,
    flag: '',
  }),
]);

function sampleCallRecording() {
  return {
    available: true,
    preview: true,
    sample: true,
    liveCapture: false,
    label: 'Call recording (preview - sample)',
    note: CALL_RECORDING_PREVIEW_NOTE,
    audioUrl: SAMPLE_AUDIO_URL,
    mimeType: 'audio/mpeg',
    participants: ['Sarah Chen', 'Rohan Mehta'],
    lines: SAMPLE_LINES.map((line) => ({ ...line })),
  };
}

module.exports = {
  CALL_RECORDING_PREVIEW_NOTE,
  SAMPLE_AUDIO_URL,
  sampleCallRecording,
};
