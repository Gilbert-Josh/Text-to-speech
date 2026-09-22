import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Multer memory storage for PDF processing (up to 100MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// OpenAI client for text-to-speech only.
// The API key is read server-side and is never exposed to the React frontend.
let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is missing.');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// Gemini remains available only for the existing scanned-PDF OCR fallback.
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is missing.');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
  });
});

// Text-to-Speech API endpoint
app.post('/api/tts', async (req, res) => {
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

    const styleInstructions: Record<string, string> = {
      natural: '',
      cheerfully: 'Speak cheerfully with warm enthusiasm.',
      energetic: 'Speak with high energy and enthusiasm.',
      storyteller: 'Narrate dramatically like an audiobook storyteller.',
      authoritative: 'Deliver with a confident, authoritative tone.',
      calm: 'Speak calmly and gently.',
      whisper: 'Speak softly and intimately.',
      'news-anchor': 'Read in a clear broadcast-news style.',
    };

    const selectedStyle =
      typeof speakingStyle === 'string' && speakingStyle in styleInstructions
        ? speakingStyle
        : 'natural';

    const instructions = styleInstructions[selectedStyle];
    const openai = getOpenAI();

    const response = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: selectedVoice,
      input: inputText,
      ...(instructions ? { instructions } : {}),
      response_format: 'wav',
    });

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    if (!audioBuffer.length) {
      return res.status(502).json({
        error: 'No audio data was returned by the speech model.',
      });
    }

    return res.json({
      audioBase64: audioBuffer.toString('base64'),
      mimeType: 'audio/wav',
      engine: 'openai',
      voice: selectedVoice,
      style: selectedStyle,
    });
  } catch (error: any) {
    const rawMsg = error?.message || '';

    console.error('Error generating OpenAI speech:', error);

    if (error?.status === 401 || error?.code === 'invalid_api_key') {
      return res.status(500).json({
        error: 'OpenAI API authentication failed. Check OPENAI_API_KEY.',
        isApiKeyMissing: false,
      });
    }

    if (error?.status === 429) {
      return res.status(429).json({
        error: 'OpenAI rate limit or quota reached. Please wait and try again.',
        isQuotaExhausted: true,
        fallbackAvailable: true,
      });
    }

    return res.status(500).json({
      error: rawMsg || 'Failed to generate speech',
      isApiKeyMissing: rawMsg.includes('OPENAI_API_KEY'),
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
      // 1. Fast local extraction via PDFParse
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

    // 2. If the PDF is scanned or extracted very little text, attempt Gemini OCR extraction
    if (fullText.trim().length < 50 && process.env.GEMINI_API_KEY) {
      try {
        const ai = getGenAI();
        const ocrResponse = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    data: req.file.buffer.toString('base64'),
                    mimeType: 'application/pdf',
                  },
                },
                {
                  text: 'Extract and transcribe all the written text in this PDF document verbatim for text-to-speech reading. Do not include commentary, just the full extracted text.',
                },
              ],
            },
          ],
        });

        const ocrText = ocrResponse.text?.trim() || '';
        if (ocrText.length > fullText.trim().length) {
          fullText = ocrText;
          pages = [
            {
              pageNumber: 1,
              text: fullText,
              wordCount: fullText ? fullText.split(/\s+/).length : 0,
            },
          ];
        }
      } catch (ocrError) {
        console.warn('Gemini PDF OCR fallback error:', ocrError);
      }
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

// Global JSON error handler for /api routes to prevent HTML error responses
app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('API error middleware caught:', err);
  const status = typeof err.status === 'number' ? err.status : (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({
    error: err.message || 'Internal server error occurred',
  });
});

// Vite middleware / SPA fallback
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
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
