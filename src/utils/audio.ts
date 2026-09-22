/**
 * Audio processing utilities for Text-To-Speech
 */

/**
 * Creates a valid RIFF WAV header for raw 16-bit mono PCM data.
 */
export function pcmToWavBlob(
  pcmData: Uint8Array,
  sampleRate: number = 24000,
  numChannels: number = 1,
  bitsPerSample: number = 16
): Blob {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length minus RIFF header and size */
  view.setUint32(4, 36 + dataSize, true);
  /* RIFF type & format header */
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (1 is PCM) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, byteRate, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, blockAlign, true);
  /* bits per sample */
  view.setUint16(34, bitsPerSample, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, dataSize, true);

  // Write PCM samples
  const wavBytes = new Uint8Array(buffer);
  wavBytes.set(pcmData, 44);

  return new Blob([wavBytes], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Parses base64 audio data returned from Gemini TTS.
 * If raw PCM or if missing RIFF header, encapsulates into valid WAV.
 */
export function processBase64Audio(base64: string, mimeType: string = 'audio/wav'): {
  blobUrl: string;
  blob: Blob;
} {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // Check if it already has a RIFF header
  const isRiffWav =
    bytes.length >= 4 &&
    bytes[0] === 0x52 && // 'R'
    bytes[1] === 0x49 && // 'I'
    bytes[2] === 0x46 && // 'F'
    bytes[3] === 0x46; // 'F'

  if (isRiffWav || mimeType.includes('mp3') || mimeType.includes('ogg')) {
    const blob = new Blob([bytes], { type: mimeType });
    return {
      blob,
      blobUrl: URL.createObjectURL(blob),
    };
  }

  // Assume 24kHz 16-bit mono PCM (standard Gemini TTS output)
  const wavBlob = pcmToWavBlob(bytes, 24000, 1, 16);
  return {
    blob: wavBlob,
    blobUrl: URL.createObjectURL(wavBlob),
  };
}

/**
 * Triggers browser download for a Blob
 */
export function downloadAudioBlob(blob: Blob, filename: string = 'speech-audio.wav') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
