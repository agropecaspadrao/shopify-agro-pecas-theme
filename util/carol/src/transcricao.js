// Transcrição de áudios do WhatsApp via Groq (Whisper large-v3-turbo).
// A Groq tem camada gratuita generosa para speech-to-text; basta criar uma
// conta em console.groq.com e definir GROQ_API_KEY.

import { config } from './config.js';

const URL_TRANSCRICAO = 'https://api.groq.com/openai/v1/audio/transcriptions';

export function transcricaoDisponivel() {
  return Boolean(config.groqApiKey);
}

/**
 * Transcreve um áudio (Buffer) para texto em português.
 * Retorna null quando a transcrição não está configurada ou vem vazia.
 */
export async function transcreverAudio(buffer, mime = 'audio/ogg') {
  if (!config.groqApiKey) return null;

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), 'audio.ogg');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'pt');
  form.append('temperature', '0');

  const res = await fetch(URL_TRANSCRICAO, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.groqApiKey}` },
    body: form,
  });
  if (!res.ok) {
    const erro = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${erro.slice(0, 300)}`);
  }
  const dados = await res.json();
  const texto = (dados.text || '').trim();
  return texto || null;
}
