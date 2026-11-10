/**
 * Read-only counselor card for the sample call.
 * Classic script (window.AegisCallRecording) and required by unit tests.
 * The native audio control is the only playback UI.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AegisCallRecording = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function callRecordingCardFactory() {
  const DEFAULT_NOTE =
    'Preview with sample data. Live Agora calls, Whisper transcripts and S3 storage are on the roadmap.';
  const DEFAULT_AUDIO = '/call-recording-sample.mp3';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeAudioUrl(url) {
    const value = String(url || DEFAULT_AUDIO);
    if (!/^\/[A-Za-z0-9._/-]+$/.test(value) || value.includes('..')) return DEFAULT_AUDIO;
    return value;
  }

  function render(recording) {
    const data = recording && typeof recording === 'object' ? recording : {};
    const label = data.label || 'Call recording (preview - sample)';
    const note = data.note || DEFAULT_NOTE;
    const src = safeAudioUrl(data.audioUrl);
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const transcript = lines
      .map((line) => {
        const flagged = Boolean(line && line.flagged);
        const flag = flagged
          ? `<p class="flag-tag">AI-flagged · ${escapeHtml(line.flag || 'Review')}</p>`
          : '';
        return `<li class="${flagged ? 'flagged' : ''}"><p><time>${escapeHtml(
          line && line.at
        )}</time> <strong>${escapeHtml(line && line.speaker)}</strong> ${escapeHtml(
          line && line.text
        )}</p>${flag}</li>`;
      })
      .join('');

    return `<section class="evidence-card call-recording" aria-label="${escapeHtml(label)}">
      <h4>${escapeHtml(label)}</h4>
      <audio controls preload="metadata" src="${escapeHtml(src)}">Sample call audio</audio>
      ${transcript ? `<ol class="call-transcript">${transcript}</ol>` : ''}
      <p class="call-recording-note">${escapeHtml(note)}</p>
    </section>`;
  }

  return { render, escapeHtml, safeAudioUrl };
});
