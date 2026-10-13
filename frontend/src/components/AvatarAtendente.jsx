import { useState, useEffect } from 'react';
import api from '../lib/api.js';

// A foto não pode ir direto num <img src>: a rota é autenticada e a tag <img>
// não carrega o cabeçalho de sessão. Então busca pelo axios e vira object URL.
//
// A chave do cache inclui a versão, então trocar a foto invalida sozinho — e
// como a versão só muda quando alguém troca a imagem, uma foto é baixada uma
// vez por aba. Os object URLs não são revogados de propósito: são poucos KB por
// atendente e vivem o tempo da aba, enquanto revogar exigiria saber que nenhum
// avatar na tela ainda aponta para eles.
const cache = new Map();

function useFoto(id, versao) {
  const chave = id && versao ? `${id}:${versao}` : null;
  const [url, setUrl] = useState(() => (chave ? cache.get(chave) || null : null));

  useEffect(() => {
    if (!chave) { setUrl(null); return; }

    const pronta = cache.get(chave);
    if (pronta) { setUrl(pronta); return; }

    let vivo = true;
    api.get(`/fotos/${id}`, { responseType: 'blob', params: { v: versao } })
      .then(r => {
        const objeto = URL.createObjectURL(r.data);
        cache.set(chave, objeto);
        if (vivo) setUrl(objeto);
      })
      // Sem foto, foto corrompida ou atendente de outro provedor: cai na
      // inicial, que é o que a tela mostrava antes de existir avatar.
      .catch(() => { if (vivo) setUrl(null); });

    return () => { vivo = false; };
  }, [chave, id, versao]);

  return url;
}

export default function AvatarAtendente({ id, nome, fotoVersao, tamanho = 28, cor, className = '' }) {
  const foto = useFoto(id, fotoVersao);
  const inicial = (nome || '?').trim()[0]?.toUpperCase() || '?';

  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold text-white overflow-hidden shrink-0 ${className}`}
      style={{
        width: tamanho,
        height: tamanho,
        backgroundColor: foto ? 'transparent' : cor,
        fontSize: Math.round(tamanho * 0.42),
      }}
    >
      {foto
        ? <img src={foto} alt={nome} className="w-full h-full object-cover" />
        : inicial}
    </div>
  );
}

// Reduz para um quadrado de 96px antes de enviar. Sem isso, foto de celular
// sairia com alguns MB em base64 dentro do banco e em toda listagem que
// carregasse o avatar. Recorta o centro porque redimensionar retângulo para
// quadrado deixa o rosto achatado.
export function reduzirParaAvatar(file, lado = 96) {
  return new Promise((resolve, reject) => {
    const temp = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(temp);
      const corte = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = lado;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, (img.width - corte) / 2, (img.height - corte) / 2, corte, corte, 0, 0, lado, lado);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(temp); reject(new Error('Arquivo não é uma imagem válida.')); };
    img.src = temp;
  });
}
