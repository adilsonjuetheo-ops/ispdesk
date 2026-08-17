import { spawn } from 'node:child_process';

// Formatos de áudio que o WhatsApp aceita. WebM não está na lista: o Chrome
// grava nesse container e ele precisa ser convertido antes de subir.
const AUDIO_ACEITO_WHATSAPP = new Set([
  'audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg',
]);

export function audioPrecisaConverter(mimeType) {
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return base.startsWith('audio/') && !AUDIO_ACEITO_WHATSAPP.has(base);
}

// Converte para Ogg/Opus mono 48kHz — é o formato que o WhatsApp exibe como
// mensagem de voz, com a onda sonora, em vez de anexo de áudio.
export function converterParaOggOpus(buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '32k',
      '-ar', '48000',
      '-ac', '1',
      '-f', 'ogg',
      'pipe:1',
    ]);

    const saida = [];
    const erro = [];
    ff.stdout.on('data', c => saida.push(c));
    ff.stderr.on('data', c => erro.push(c));
    ff.on('error', err => reject(new Error(`ffmpeg indisponível: ${err.message}`)));
    ff.on('close', codigo => {
      if (codigo !== 0) {
        return reject(new Error(`ffmpeg falhou (${codigo}): ${Buffer.concat(erro).toString().slice(0, 200)}`));
      }
      const convertido = Buffer.concat(saida);
      if (convertido.subarray(0, 4).toString('ascii') !== 'OggS') {
        return reject(new Error('ffmpeg não produziu um arquivo Ogg válido'));
      }
      resolve(convertido);
    });

    // O ffmpeg fecha a entrada assim que já leu o suficiente; sem isso o
    // EPIPE derruba o processo do Node.
    ff.stdin.on('error', () => {});
    ff.stdin.end(buffer);
  });
}

// Converte para MP3 ao servir a mídia ao painel. O WhatsApp entrega Ogg/Opus,
// que o Safari não reproduz de jeito nenhum e que o Chrome recusou em blob
// dentro do PWA. MP3 toca em todo navegador e tem duração bem definida, que é
// o que o player precisa para liberar o play.
export function converterParaMp3(buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '64k',
      '-ar', '44100',
      '-ac', '1',
      '-f', 'mp3',
      'pipe:1',
    ]);

    const saida = [];
    const erro = [];
    ff.stdout.on('data', c => saida.push(c));
    ff.stderr.on('data', c => erro.push(c));
    ff.on('error', err => reject(new Error(`ffmpeg indisponível: ${err.message}`)));
    ff.on('close', codigo => {
      if (codigo !== 0) {
        return reject(new Error(`ffmpeg falhou (${codigo}): ${Buffer.concat(erro).toString().slice(0, 200)}`));
      }
      const mp3 = Buffer.concat(saida);
      if (!mp3.length) return reject(new Error('ffmpeg devolveu áudio vazio'));
      resolve(mp3);
    });

    ff.stdin.on('error', () => {});
    ff.stdin.end(buffer);
  });
}
