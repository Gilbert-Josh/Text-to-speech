import * as lamejs from '@breezystack/lamejs';

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let value = '';
  for (let i = 0; i < length; i += 1) {
    value += String.fromCharCode(view.getUint8(offset + i));
  }
  return value;
}

function extractPcmFromWav(bytes: Uint8Array): { pcm: Int16Array; sampleRate: number; channels: number } {
  if (bytes.length < 44 || readAscii(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, 4) !== 'RIFF') {
    throw new Error('Kokoro returned an invalid WAV file.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let channels = 1;
  let sampleRate = 24000;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;

    if (chunkId === 'fmt ' && chunkStart + chunkSize <= bytes.length) {
      channels = view.getUint16(chunkStart + 2, true);
      sampleRate = view.getUint32(chunkStart + 4, true);
      bitsPerSample = view.getUint16(chunkStart + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = chunkStart;
      dataSize = Math.min(chunkSize, bytes.length - chunkStart);
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || bitsPerSample !== 16) {
    throw new Error('Kokoro returned an unsupported WAV format.');
  }

  const sampleCount = Math.floor(dataSize / 2);
  const pcm = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    pcm[i] = view.getInt16(dataOffset + i * 2, true);
  }

  return { pcm, sampleRate, channels };
}

/**
 * Converts one Kokoro 24 kHz WAV response into MP3 frames.
 * The browser performs encoding locally, so the completed PDF never needs
 * to be uploaded to an external MP3 service.
 */
export function encodeKokoroWavBase64ToMp3(
  base64: string,
  encoder: lamejs.Mp3Encoder
): Int8Array[] {
  const { pcm, sampleRate, channels } = extractPcmFromWav(base64ToBytes(base64));

  if (sampleRate !== 24000) {
    throw new Error(`Unexpected Kokoro sample rate: ${sampleRate} Hz.`);
  }

  const frames: Int8Array[] = [];
  const blockSize = 1152;

  if (channels === 1) {
    for (let offset = 0; offset < pcm.length; offset += blockSize) {
      const block = pcm.subarray(offset, Math.min(offset + blockSize, pcm.length));
      const encoded = encoder.encodeBuffer(block);
      if (encoded.length) frames.push(new Int8Array(encoded));
    }
  } else if (channels === 2) {
    const left = new Int16Array(Math.floor(pcm.length / 2));
    const right = new Int16Array(Math.floor(pcm.length / 2));

    for (let i = 0, j = 0; j < left.length; i += 2, j += 1) {
      left[j] = pcm[i];
      right[j] = pcm[i + 1];
    }

    for (let offset = 0; offset < left.length; offset += blockSize) {
      const leftBlock = left.subarray(offset, Math.min(offset + blockSize, left.length));
      const rightBlock = right.subarray(offset, Math.min(offset + blockSize, right.length));
      const encoded = encoder.encodeBuffer(leftBlock, rightBlock);
      if (encoded.length) frames.push(new Int8Array(encoded));
    }
  } else {
    throw new Error(`Unsupported Kokoro channel count: ${channels}.`);
  }

  return frames;
}

export function finishMp3Encoding(encoder: lamejs.Mp3Encoder): Int8Array | null {
  const flushed = encoder.flush();
  return flushed.length ? new Int8Array(flushed) : null;
}

export function downloadMp3(frames: Int8Array[], filename: string) {
  const blob = new Blob(frames as BlobPart[], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return blob;
}
