import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

// Allow the Firefox WebExtension to call the local API.
// This is restricted to localhost/127.0.0.1 origins rather than enabling
// arbitrary remote web pages to use the local TTS service.
app.use((req, res, next) => {
  const origin = req.header('origin') || '';

  if (
    origin.startsWith('moz-extension://') ||
    origin === 'http://localhost:3000' ||
    origin === 'http://127.0.0.1:3000'
  ) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: '10mb' }));

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const configuredKey = process.env.TTS_API_KEY;

  if (!configuredKey) {
    return next();
  }

  const authorization = req.header('authorization') || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const suppliedKey = bearerMatch?.[1] || req.header('x-api-key');

  if (!suppliedKey || suppliedKey !== configuredKey) {
    return res.status(401).json({
      error: 'Unauthorized. Supply a valid API key using Authorization: Bearer <TTS_API_KEY> or x-api-key.',
    });
  }

  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Local Kokoro TTS is invoked through the Python worker.
// No paid TTS API key is required for speech generation.
const APP_ROOT = process.env.APP_ROOT || process.cwd();
const APP_RESOURCES = process.env.APP_RESOURCES_PATH || APP_ROOT;
const KOKORO_SCRIPT = process.env.KOKORO_SCRIPT || (
  process.env.APP_RESOURCES_PATH
    ? path.join(APP_RESOURCES, 'local-tts', 'kokoro_tts.py')
    : path.join(APP_ROOT, 'local-tts', 'kokoro_tts.py')
);

const styleInstructions: Record<string, string> = {
  natural: '',
  cheerfully: 'Speak cheerfully with warm enthusiasm: ',
  energetic: 'Speak with high energy and enthusiasm: ',
  storyteller: 'Narrate dramatically like an audiobook storyteller: ',
  authoritative: 'Deliver with a confident, authoritative tone: ',
  calm: 'Speak calmly and gently: ',
  whisper: 'Speak softly and intimately: ',
  'news-anchor': 'Read in a clear broadcast-news style: ',
};

let persistentWorker: import('node:child_process').ChildProcessWithoutNullStreams | null = null;
let persistentStdoutBuffer = '';
let persistentWaiters: Array<{
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
}> = [];

function resetPersistentWorker(error?: Error) {
  const failure = error || new Error('Local Kokoro worker stopped unexpectedly.');
  for (const waiter of persistentWaiters.splice(0)) {
    waiter.reject(failure);
  }
  persistentStdoutBuffer = '';
  persistentWorker = null;
}

function ensurePersistentWorker() {
  if (persistentWorker && !persistentWorker.killed) {
    return persistentWorker;
  }

  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  const pythonCommand = getKokoroPythonCommand();
  const workerArgs = process.env.APP_RESOURCES_PATH
    ? []
    : [KOKORO_SCRIPT];

  const workerCwd = process.env.APP_RESOURCES_PATH
    ? path.dirname(getKokoroPythonCommand())
    : APP_ROOT;

  persistentWorker = spawn(pythonCommand, workerArgs, {
    cwd: workerCwd,
    windowsHide: true,
    env: {
      ...process.env,
      KOKORO_PERSISTENT: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  persistentWorker.stdout.on('data', (chunk: Buffer) => {
    persistentStdoutBuffer += chunk.toString('utf8');

    let newlineIndex = persistentStdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = persistentStdoutBuffer.slice(0, newlineIndex).trim();
      persistentStdoutBuffer = persistentStdoutBuffer.slice(newlineIndex + 1);

      if (line) {
        const waiter = persistentWaiters.shift();
        if (!waiter) {
          console.warn('Unexpected Kokoro worker output:', line);
        } else {
          try {
            const response = JSON.parse(line);
            if (response.ok && response.path) {
              waiter.resolve(response.path);
            } else {
              waiter.reject(new Error(response.error || 'Kokoro TTS failed.'));
            }
          } catch {
            waiter.reject(new Error('Kokoro worker returned invalid output.'));
          }
        }
      }

      newlineIndex = persistentStdoutBuffer.indexOf('\n');
    }
  });

  persistentWorker.stderr.on('data', (chunk: Buffer) => {
    console.error('[Kokoro]', chunk.toString('utf8').trim());
  });

  persistentWorker.once('error', (error) => {
    resetPersistentWorker(error instanceof Error ? error : new Error(String(error)));
  });

  persistentWorker.once('close', (code) => {
    resetPersistentWorker(new Error(`Kokoro worker exited with code ${code ?? 'unknown'}.`));
  });

  return persistentWorker;
}

let persistentQueue = Promise.resolve();

function generateWithPersistentKokoro(request: {
  text: string;
  voice: string;
  style: string;
}): Promise<string> {
  const job = persistentQueue.then(() => new Promise<string>((resolve, reject) => {
    const worker = ensurePersistentWorker();
    persistentWaiters.push({ resolve, reject });

    try {
      worker.stdin.write(JSON.stringify(request) + '\n');
    } catch (error) {
      persistentWaiters.pop();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  }));

  persistentQueue = job.then(() => undefined, () => undefined);
  return job;
}

function getKokoroPythonCommand(): string {
  if (process.env.PYTHON_COMMAND) {
    return process.env.PYTHON_COMMAND;
  }

  if (process.env.APP_RESOURCES_PATH) {
    return path.join(APP_RESOURCES, 'kokoro-runtime', 'kokoro_tts', 'kokoro_tts.exe');
  }

  return process.platform === 'win32'
    ? path.join(APP_ROOT, '.kokoro-venv', 'Scripts', 'python.exe')
    : path.join(APP_ROOT, '.kokoro-venv', 'bin', 'python');
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    ttsEngine: 'kokoro-local',
    kokoroPython: getKokoroPythonCommand(),
  });
});

app.post('/api/tts', requireApiKey, async (req, res) => {
  try {
    const { text, voice = 'alloy', speakingStyle = 'natural' } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text input is required' });
    }

    const inputText = text.trim();

    if (inputText.length > 4096) {
      return res.status(400).json({
        error: 'Text input must be 4096 characters or fewer.',
      });
    }

    const allowedVoices = new Set([
      'alloy',
      'ash',
      'ballad',
      'coral',
      'echo',
      'fable',
      'nova',
      'onyx',
      'sage',
      'shimmer',
    ]);

    const selectedVoice = allowedVoices.has(String(voice).toLowerCase())
      ? String(voice).toLowerCase()
      : 'alloy';

    const selectedStyle =
      typeof speakingStyle === 'string' && speakingStyle in styleInstructions
        ? speakingStyle
        : 'natural';

    const outputPath = await generateWithPersistentKokoro({
      text: inputText,
      voice: selectedVoice,
      style: selectedStyle,
    });

    const fs = await import('node:fs/promises');
    const audioBuffer = await fs.readFile(outputPath);

    await fs.unlink(outputPath).catch(() => undefined);

    if (!audioBuffer.length) {
      return res.status(502).json({
        error: 'Kokoro TTS returned an empty audio file.',
      });
    }

    return res.json({
      audioBase64: audioBuffer.toString('base64'),
      mimeType: 'audio/wav',
      engine: 'kokoro-local',
      voice: selectedVoice,
      style: selectedStyle,
    });
  } catch (error: any) {
    console.error('Error generating local Kokoro speech:', error);

    return res.status(500).json({
      error:
        error?.message ||
        'Failed to generate speech using local Kokoro TTS.',
    });
  }
});

// PDF Text Extraction endpoint
app.post('/api/pdf-extract', (req, res, next) => {
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File size exceeds the 100MB limit.' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file was uploaded.' });
    }

    if (req.file.mimetype !== 'application/pdf' && !req.file.originalname.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Uploaded file must be a PDF document.' });
    }

    let fullText = '';
    let pages: Array<{ pageNumber: number; text: string; wordCount: number }> = [];
    let numPages = 1;

    try {
      const parser = new PDFParse({ data: req.file.buffer });
      const textResult = await parser.getText();

      numPages = textResult.total || 1;
      if (textResult.pages && Array.isArray(textResult.pages) && textResult.pages.length > 0) {
        pages = textResult.pages.map((p: any) => {
          const cleanText = (p.text || '').replace(/\r\n/g, '\n').trim();
          const wordCount = cleanText ? cleanText.split(/\s+/).length : 0;
          return {
            pageNumber: p.num || 1,
            text: cleanText,
            wordCount,
          };
        });
        fullText = pages.map((p) => p.text).filter(Boolean).join('\n\n');
      } else if (textResult.text) {
        fullText = textResult.text.replace(/\r\n/g, '\n').trim();
        pages = [
          {
            pageNumber: 1,
            text: fullText,
            wordCount: fullText ? fullText.split(/\s+/).length : 0,
          },
        ];
      }
    } catch (parseError) {
      console.warn('PDFParse local extraction warning:', parseError);
    }

    if (!fullText.trim()) {
      return res.status(422).json({
        error: 'No readable text could be extracted from this PDF document. It may be empty or password-protected.',
      });
    }

    return res.json({
      filename: req.file.originalname,
      sizeBytes: req.file.size,
      numPages,
      fullText,
      pages,
    });
  } catch (error: any) {
    console.error('PDF extraction failed:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to process PDF document.',
    });
  }
});

app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('API error middleware caught:', err);
  const status = typeof err.status === 'number' ? err.status : (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({
    error: err.message || 'Internal server error occurred',
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(APP_ROOT, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
