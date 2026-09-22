# API

Base URL (local):

`http://localhost:3000`

The API is served by the Express backend. The OpenAI API key is never sent to clients.

## Authentication

For external API access, configure:

```env
TTS_API_KEY=replace_with_a_private_client_key
OPENAI_API_KEY=replace_with_your_openai_api_key
```

Send the client key as either:

```
Authorization: Bearer <TTS_API_KEY>
```

or:

```
x-api-key: <TTS_API_KEY>
```

When `TTS_API_KEY` is not configured, the API remains open for local development.

## GET /api/health

Returns backend health and whether the server has an OpenAI key configured.

Example:

```json
{
  "status": "ok",
  "hasApiKey": true
}
```

## POST /api/tts

Converts text to WAV speech using OpenAI `gpt-4o-mini-tts`.

Request:

```http
POST /api/tts
Content-Type: application/json
Authorization: Bearer <TTS_API_KEY>
```

Body:

```json
{
  "text": "Hello from my application.",
  "voice": "alloy",
  "speakingStyle": "natural"
}
```

Supported voices:

```
alloy
ash
ballad
coral
echo
fable
nova
onyx
sage
shimmer
```

Supported styles:

```
natural
cheerfully
authoritative
calm
whisper
storyteller
news-anchor
```

Maximum input length: 4096 characters.

Response:

```json
{
  "audioBase64": "<base64 WAV audio>",
  "mimeType": "audio/wav",
  "engine": "openai",
  "voice": "alloy",
  "style": "natural"
}
```

To play the returned audio in a browser:

```ts
const audio = new Audio(
  `data:${response.mimeType};base64,${response.audioBase64}`
);
audio.play();
```

## POST /api/pdf-extract

Uploads a PDF as multipart form data and returns extracted text.

Request:

```http
POST /api/pdf-extract
Content-Type: multipart/form-data
Authorization: Bearer <TTS_API_KEY>
```

Form field:

`file`

Response:

```json
{
  "filename": "example.pdf",
  "sizeBytes": 12345,
  "numPages": 2,
  "fullText": "Extracted text...",
  "pages": [
    {
      "pageNumber": 1,
      "text": "Page text...",
      "wordCount": 2
    }
  ]
}
```
