import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { buscarLinkFatura, registrarAbertura } from '../services/faturaLink.js';

const router = Router();

// Única página do sistema aberta ao cliente final, sem login. Ela existe por um
// motivo só: o WhatsApp não deixa copiar um pedaço de uma mensagem. Com o
// código PIX no corpo do lembrete, segurar o balão copiava o texto inteiro — o
// cliente colava "Prezado cliente..." no app do banco e não conseguia pagar.
//
// Aqui o código fica sozinho atrás de um botão: um toque, código na área de
// transferência, nada em volta.

function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatarValor(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2).replace('.', ',');
}

function formatarData(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('pt-BR');
}

// A cor vem do banco e entra dentro de `style`: se o provedor salvar qualquer
// coisa ali, vira injeção de CSS. Só passa hexadecimal.
function corSegura(cor) {
  return /^#[0-9a-fA-F]{3,8}$/.test(cor || '') ? cor : '#0066CC';
}

// O link do boleto também vem do SGP e vira href. Sem filtro, um `javascript:`
// gravado lá executaria no navegador do cliente.
function urlSegura(url) {
  return /^https?:\/\//i.test(url || '') ? url : null;
}

function pagina({ titulo, corpo, cor = '#0066CC', nonce }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${escapar(titulo)}</title>
<style nonce="${nonce}">
  :root { --cor: ${cor}; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
    background: #f3f4f6; color: #111827; line-height: 1.5;
    display: flex; justify-content: center;
  }
  .cartao { width: 100%; max-width: 420px; background: #fff; border-radius: 16px;
            padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .provedor { font-size: 13px; font-weight: 600; color: var(--cor);
              text-transform: uppercase; letter-spacing: .04em; margin: 0 0 20px; }
  .logo { max-height: 44px; max-width: 160px; display: block; margin: 0 0 16px; }
  .valor { font-size: 34px; font-weight: 700; margin: 0; letter-spacing: -.02em; }
  .descricao { margin: 4px 0 16px; color: #6b7280; font-size: 14px; }
  .linha { display: flex; justify-content: space-between; gap: 12px;
           padding: 12px 0; border-top: 1px solid #e5e7eb; font-size: 14px; }
  .linha span:first-child { color: #6b7280; }
  .linha span:last-child { font-weight: 600; text-align: right; }
  .vencida { color: #b91c1c; }
  button.copiar {
    width: 100%; margin-top: 20px; padding: 16px; border: 0; border-radius: 12px;
    background: var(--cor); color: #fff; font-size: 17px; font-weight: 600;
    cursor: pointer; font-family: inherit;
  }
  button.copiar:active { opacity: .85; }
  button.copiar.feito { background: #15803d; }
  .codigo {
    margin-top: 14px; width: 100%; min-height: 84px; padding: 12px;
    border: 1px solid #e5e7eb; border-radius: 10px; background: #f9fafb;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
    color: #374151; resize: none; word-break: break-all;
  }
  .dica { margin: 10px 0 0; font-size: 12px; color: #6b7280; text-align: center; }
  .boleto { display: block; margin-top: 16px; padding: 14px; text-align: center;
            border: 1px solid var(--cor); border-radius: 12px; color: var(--cor);
            text-decoration: none; font-weight: 600; font-size: 15px; }
  .aviso { margin: 0; font-size: 15px; color: #374151; }
  h1.aviso-titulo { font-size: 19px; margin: 0 0 8px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b0f17; color: #e5e7eb; }
    .cartao { background: #151a23; box-shadow: none; }
    .linha { border-color: #273142; }
    .codigo { background: #0b0f17; border-color: #273142; color: #cbd5e1; }
    .aviso { color: #cbd5e1; }
  }
</style>
</head>
<body><main class="cartao">${corpo}</main></body>
</html>`;
}

function responder(res, nonce, html, status = 200) {
  // O CSP global é `default-src 'none'`, que mataria o estilo e o script desta
  // página. Aqui ela recebe o seu próprio, ainda fechado: só o que o cartão
  // usa, e nada de rede externa além da imagem da logo.
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; ` +
    `img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  );
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(status).send(html);
}

function telaAviso(res, nonce, titulo, mensagem, status) {
  return responder(res, nonce, pagina({
    titulo,
    nonce,
    corpo: `<h1 class="aviso-titulo">${escapar(titulo)}</h1><p class="aviso">${escapar(mensagem)}</p>`,
  }), status);
}

router.get('/:token', async (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64');

  try {
    const registro = await buscarLinkFatura(req.params.token);
    if (!registro) {
      return telaAviso(res, nonce, 'Link não encontrado',
        'Este link de pagamento não existe ou já foi removido. Fale com o seu provedor pelo WhatsApp.', 404);
    }
    if (registro.expiraEm && new Date(registro.expiraEm) < new Date()) {
      return telaAviso(res, nonce, 'Link expirado',
        'Este link de pagamento venceu. Peça uma nova segunda via pelo WhatsApp do seu provedor.', 410);
    }

    const [tenant] = await db.select({
      nome: tenants.nome,
      nomeFantasia: tenants.nomeFantasia,
      logoUrl: tenants.logoUrl,
      corPrimaria: tenants.corPrimaria,
    }).from(tenants).where(eq(tenants.id, registro.tenantId)).limit(1);

    const cor = corSegura(tenant?.corPrimaria);
    const nomeProvedor = tenant?.nomeFantasia || tenant?.nome || 'Pagamento';
    const valor = formatarValor(registro.valor);
    const vencimento = formatarData(registro.vencimento);
    const vencida = registro.vencimento
      ? String(registro.vencimento).slice(0, 10) < new Date().toISOString().slice(0, 10)
      : false;
    const boleto = urlSegura(registro.linkBoleto);
    const logo = urlSegura(tenant?.logoUrl);

    // Sem PIX e sem boleto a página não tem o que oferecer — melhor dizer isso
    // do que mostrar um cartão com um botão que não copia nada.
    if (!registro.codigoPix && !boleto) {
      return telaAviso(res, nonce, 'Pagamento indisponível',
        'Não encontramos a forma de pagamento desta fatura. Fale com o seu provedor pelo WhatsApp.', 404);
    }

    const partes = [];
    if (logo) {
      partes.push(`<img class="logo" src="${escapar(logo)}" alt="${escapar(nomeProvedor)}">`);
    } else {
      partes.push(`<p class="provedor">${escapar(nomeProvedor)}</p>`);
    }
    partes.push(`<p class="valor">${valor ? `R$ ${escapar(valor)}` : 'Fatura'}</p>`);
    partes.push(`<p class="descricao">${escapar(registro.descricao || 'Mensalidade')}</p>`);
    if (registro.clienteNome) {
      partes.push(`<div class="linha"><span>Cliente</span><span>${escapar(registro.clienteNome)}</span></div>`);
    }
    if (vencimento) {
      partes.push(`<div class="linha"><span>${vencida ? 'Venceu em' : 'Vencimento'}</span>` +
        `<span${vencida ? ' class="vencida"' : ''}>${escapar(vencimento)}</span></div>`);
    }

    if (registro.codigoPix) {
      partes.push('<button class="copiar" id="btn" type="button">Copiar código PIX</button>');
      // O código também fica num campo selecionável: se a área de transferência
      // falhar (WebView sem permissão, navegador antigo), o cliente ainda
      // consegue marcar e copiar na mão — e aí copia só o código, que era o
      // problema todo.
      partes.push(`<textarea class="codigo" id="pix" readonly rows="4">${escapar(registro.codigoPix)}</textarea>`);
      partes.push('<p class="dica">Cole no app do seu banco, em PIX &rsaquo; Copia e cola.</p>');
    }
    if (boleto) {
      partes.push(`<a class="boleto" href="${escapar(boleto)}" rel="noopener noreferrer">Ver boleto</a>`);
    }

    if (registro.codigoPix) {
      partes.push(`<script nonce="${nonce}">
(function () {
  var btn = document.getElementById('btn');
  var campo = document.getElementById('pix');
  var ok = function () {
    btn.textContent = 'Código copiado!';
    btn.classList.add('feito');
    setTimeout(function () {
      btn.textContent = 'Copiar código PIX';
      btn.classList.remove('feito');
    }, 2500);
  };
  var naMao = function () {
    campo.focus();
    campo.select();
    campo.setSelectionRange(0, 999999);
  };
  btn.addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(campo.value).then(ok, naMao);
      return;
    }
    naMao();
    try { document.execCommand('copy'); ok(); } catch (e) { /* resta copiar na mão */ }
  });
})();
</script>`);
    }

    registrarAbertura(registro.token, registro.aberturas);

    return responder(res, nonce, pagina({
      titulo: `Pagar ${valor ? `R$ ${valor}` : 'fatura'} — ${nomeProvedor}`,
      corpo: partes.join('\n'),
      cor,
      nonce,
    }));
  } catch (err) {
    console.error('[pagina] Erro ao abrir link de fatura:', err.message);
    return telaAviso(res, nonce, 'Erro ao abrir',
      'Não foi possível carregar esta fatura agora. Tente de novo em alguns minutos.', 500);
  }
});

export default router;
