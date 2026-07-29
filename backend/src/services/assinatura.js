import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import FormData from 'form-data';
import fetch from 'node-fetch';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function buildVariables(tenant, clienteWhatsapp, dados) {
  const hoje = new Date();
  const endPrestadora = [tenant.endereco, tenant.cidade, tenant.uf, tenant.cep].filter(Boolean).join(', ');

  return {
    razao_social:           tenant.nome || '',
    cnpj_prestadora:        tenant.cnpj || '',
    endereco_prestadora:    endPrestadora,
    numero_anatel:          dados.numero_anatel || 'N/A',
    telefone_suporte:       tenant.telefone || '',
    email_suporte:          tenant.email || '',
    site:                   tenant.website || '',
    atendimento_presencial: dados.atendimento_presencial || 'Não disponível',
    canal_lgpd:             tenant.email || '',
    url_privacidade:        tenant.website || '',
    cidade_foro:            dados.cidade_foro || tenant.cidade || '',
    uf:                     dados.uf || tenant.uf || '',
    cidade_assinatura:      dados.cidade_foro || tenant.cidade || '',
    dia_assinatura:         String(hoje.getDate()).padStart(2, '0'),
    mes_assinatura:         MESES[hoje.getMonth()],
    ano_assinatura:         String(hoje.getFullYear()),
    nome_representante:     dados.nome_representante || '',
    nome_contratante:       dados.nome_contratante || '',
    cpf_cnpj:               dados.cpf_cnpj || '',
    rg:                     dados.rg || 'N/A',
    endereco_contratante:   dados.endereco_contratante || '',
    telefone:               clienteWhatsapp.replace(/\D/g, ''),
    email:                  dados.email || '',
    identificacao_oferta:   dados.identificacao_oferta || '',
    tecnologia:             dados.tecnologia || 'Fibra Óptica',
    velocidade_download:    dados.velocidade_download || '',
    velocidade_upload:      dados.velocidade_upload || '',
    mensalidade:            dados.mensalidade || '',
    taxa_instalacao:        dados.taxa_instalacao || '0,00',
    dia_vencimento:         dados.dia_vencimento || '',
    franquia:               dados.franquia || 'Ilimitada',
    endereco_instalacao:    dados.endereco_instalacao || dados.endereco_contratante || '',
    tipo_ip:                dados.tipo_ip || 'Dinâmico',
    equipamentos:           dados.equipamentos || '',
    prazo_instalacao:       dados.prazo_instalacao || '7',
    prazo_permanencia:      dados.prazo_permanencia || 'Sem fidelidade',
    numero_oferta_anatel:   dados.numero_oferta_anatel || 'N/A',
    forma_pagamento:        dados.forma_pagamento || '',
    modalidade_equipamento: dados.modalidade_equipamento || 'comodato',
    valor_reposicao:        dados.valor_reposicao || '0,00',
  };
}

async function gerarPdfContrato(v) {
  const pdfDoc = await PDFDocument.create();
  const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const W = 595, H = 842;
  const mL = 60, mR = 60, mT = 60, mB = 60;
  const maxW = W - mL - mR;
  let page = pdfDoc.addPage([W, H]);
  let y = H - mT;

  function newPage() {
    page = pdfDoc.addPage([W, H]);
    y = H - mT;
  }

  function wrapText(text, font, size, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawText(text, { bold = false, size = 10, indent = 0, extraAfter = 2 } = {}) {
    const font = bold ? fontBold : fontNormal;
    const lineH = size * 1.4;
    const lines = wrapText(text, font, size, maxW - indent);
    for (const ln of lines) {
      if (y - lineH < mB) newPage();
      page.drawText(ln, { x: mL + indent, y, font, size, color: rgb(0, 0, 0) });
      y -= lineH;
    }
    y -= extraAfter;
  }

  function drawRow(label, val, size = 9.5) {
    const lW = fontBold.widthOfTextAtSize(`${label}: `, size);
    const lineH = size * 1.4;
    if (y - lineH < mB) newPage();
    page.drawText(`${label}: `, { x: mL, y, font: fontBold, size, color: rgb(0, 0, 0) });
    const valLines = wrapText(val || '', fontNormal, size, maxW - lW);
    page.drawText(valLines[0] || '', { x: mL + lW, y, font: fontNormal, size, color: rgb(0, 0, 0) });
    y -= lineH;
    for (let i = 1; i < valLines.length; i++) {
      if (y - lineH < mB) newPage();
      page.drawText(valLines[i], { x: mL + lW, y, font: fontNormal, size, color: rgb(0, 0, 0) });
      y -= lineH;
    }
    y -= 1;
  }

  function drawLine() {
    if (y - 10 < mB) newPage();
    page.drawLine({ start: { x: mL, y: y - 4 }, end: { x: W - mR, y: y - 4 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    y -= 12;
  }

  // Título
  drawText('CONTRATO DE PRESTAÇÃO DE SERVIÇO DE COMUNICAÇÃO MULTIMÍDIA (SCM)', { bold: true, size: 12, extraAfter: 2 });
  drawText('ACESSO À INTERNET', { bold: true, size: 12, extraAfter: 6 });
  drawLine();

  // Prestadora
  drawText('IDENTIFICAÇÃO DAS PARTES', { bold: true, size: 11, extraAfter: 4 });
  drawText('PRESTADORA:', { bold: true, size: 10, extraAfter: 2 });
  drawRow('Razão Social', v.razao_social);
  drawRow('CNPJ', v.cnpj_prestadora);
  drawRow('Endereço', v.endereco_prestadora);
  drawRow('N.º Autorização ANATEL', v.numero_anatel);
  drawRow('Telefone', v.telefone_suporte);
  drawRow('E-mail', v.email_suporte);
  drawRow('Site', v.site);
  y -= 6;

  // Contratante
  drawText('CONTRATANTE:', { bold: true, size: 10, extraAfter: 2 });
  drawRow('Nome / Razão Social', v.nome_contratante);
  drawRow('CPF / CNPJ', v.cpf_cnpj);
  drawRow('RG', v.rg);
  drawRow('Endereço', v.endereco_contratante);
  drawRow('Telefone / WhatsApp', v.telefone);
  drawRow('E-mail', v.email);
  y -= 4;
  drawLine();

  drawText('As partes acima celebram o presente Contrato de Prestação de Serviço de Comunicação Multimídia (SCM) — Acesso à Internet, regido pela Lei n.º 9.472/1997, pelo Regulamento SCM (Res. ANATEL n.º 614/2013), pelo Código de Defesa do Consumidor (Lei n.º 8.078/1990) e pelas cláusulas a seguir.', { size: 9.5, extraAfter: 4 });
  drawLine();

  const clausulas = [
    ['CLÁUSULA 1ª — OBJETO', [
      `A PRESTADORA obriga-se a prestar ao CONTRATANTE o serviço de acesso à Internet em banda larga (SCM):`,
      `• Identificação da Oferta: ${v.identificacao_oferta}`,
      `• Tecnologia: ${v.tecnologia} | Download: ${v.velocidade_download} Mbps | Upload: ${v.velocidade_upload} Mbps`,
      `• Franquia: ${v.franquia} | Tipo de IP: ${v.tipo_ip}`,
      `As velocidades correspondem às máximas. A mínima garantida é de 20% da velocidade contratada (Res. ANATEL 614/2013).`,
    ]],
    ['CLÁUSULA 2ª — ENDEREÇO DE INSTALAÇÃO', [
      `O serviço será instalado em: ${v.endereco_instalacao}. Alterações dependem de análise técnica prévia.`,
    ]],
    ['CLÁUSULA 3ª — EQUIPAMENTOS', [
      `Equipamentos fornecidos em regime de ${v.modalidade_equipamento}: ${v.equipamentos}.`,
      `Devolução em até 10 dias após o término, sob pena de cobrança de R$ ${v.valor_reposicao}.`,
    ]],
    ['CLÁUSULA 4ª — PRAZO DE INSTALAÇÃO', [
      `Instalação em até ${v.prazo_instalacao} dias úteis a partir da assinatura.`,
    ]],
    ['CLÁUSULA 5ª — VIGÊNCIA E PERMANÊNCIA', [
      `Contrato por prazo indeterminado. ${v.prazo_permanencia}.`,
    ]],
    ['CLÁUSULA 6ª — PREÇO E PAGAMENTO', [
      `• Mensalidade: R$ ${v.mensalidade} | Taxa instalação: R$ ${v.taxa_instalacao}`,
      `• Vencimento: dia ${v.dia_vencimento} | Forma: ${v.forma_pagamento}`,
      `Reajuste anual pelo IPCA com aviso de 30 dias. Atraso sujeita a multa de 2% + juros de 1% ao mês + IPCA.`,
    ]],
    ['CLÁUSULA 7ª — SUSPENSÃO DO SERVIÇO', [
      `Serviço pode ser suspenso por inadimplemento com comunicação prévia. A suspensão não rescinde o contrato. Interrupções programadas com aviso de 72h.`,
    ]],
    ['CLÁUSULA 8ª — OBRIGAÇÕES DA PRESTADORA', [
      `I — Prestar o serviço com continuidade e eficiência; II — Informar sobre alterações; III — Atendimento: ${v.telefone_suporte} | ${v.email_suporte}; IV — Reparar falhas em até 72h; V — Sigilo dos dados (LGPD).`,
    ]],
    ['CLÁUSULA 9ª — OBRIGAÇÕES DO CONTRATANTE', [
      `I — Pagar mensalidades no prazo; II — Zelar pelos equipamentos; III — Não praticar atividades ilícitas; IV — Comunicar danos; V — Não ceder o serviço sem anuência prévia.`,
    ]],
    ['CLÁUSULA 10ª — GERENCIAMENTO DE TRÁFEGO', [
      `Franquia: ${v.franquia}. Gestão de tráfego respeitando o Marco Civil da Internet (Lei 12.965/2014).`,
    ]],
    ['CLÁUSULA 11ª — RESPONSABILIDADE', [
      `A PRESTADORA não se responsabiliza por: uso indevido, caso fortuito/força maior, incompatibilidade de equipamentos do CONTRATANTE.`,
    ]],
    ['CLÁUSULA 12ª — RESCISÃO', [
      `Pelo CONTRATANTE: aviso de 30 dias. Pela PRESTADORA: inadimplemento >30 dias ou atividades ilícitas. A rescisão não exime débitos ou devolução de equipamentos.`,
    ]],
    ['CLÁUSULA 13ª — CANAIS DE RECLAMAÇÃO', [
      `Reclamações direto à PRESTADORA. Não atendido: www.consumidor.gov.br ou ANATEL (1331).`,
    ]],
    ['CLÁUSULA 14ª — OFERTA COMERCIAL', [
      `Oferta: ${v.identificacao_oferta} | N.º ANATEL: ${v.numero_oferta_anatel}. Disponível no site da PRESTADORA.`,
    ]],
    ['CLÁUSULA 15ª — LGPD', [
      `Dados tratados para execução do contrato. Direitos do titular pelo canal: ${v.canal_lgpd}. Política de Privacidade: ${v.url_privacidade}.`,
    ]],
    ['CLÁUSULA 16ª — ALTERAÇÕES CONTRATUAIS', [
      `Alterações comunicadas com 30 dias de antecedência. O CONTRATANTE pode rescindir sem ônus caso discorde.`,
    ]],
    ['CLÁUSULA 17ª — DIREITO DE ARREPENDIMENTO', [
      `Nos termos do art. 49 do CDC: 7 dias corridos para desistência sem ônus (contratos fora do estabelecimento ou eletrônicos).`,
    ]],
    ['CLÁUSULA 18ª — DISPOSIÇÕES GERAIS', [
      `Regido pelas leis brasileiras. Casos omissos: CDC, Regulamento SCM e normas ANATEL. Tolerância não implica renúncia.`,
    ]],
    [`CLÁUSULA 19ª — FORO`, [
      `Foro da Comarca de ${v.cidade_foro} — ${v.uf}, com renúncia a qualquer outro.`,
    ]],
  ];

  for (const [titulo, itens] of clausulas) {
    drawText(titulo, { bold: true, size: 10, extraAfter: 2 });
    for (const item of itens) drawText(item, { size: 9.5, indent: 8, extraAfter: 2 });
    y -= 4;
  }

  drawLine();
  drawText('LOCAL E DATA DE ASSINATURA', { bold: true, size: 10, extraAfter: 4 });
  drawText(`${v.cidade_assinatura}, ${v.dia_assinatura} de ${v.mes_assinatura} de ${v.ano_assinatura}.`, { size: 10, extraAfter: 30 });

  // Assinaturas
  if (y - 60 < mB) newPage();
  const midX = mL + (maxW / 2);
  page.drawLine({ start: { x: mL, y }, end: { x: mL + 200, y }, thickness: 1, color: rgb(0, 0, 0) });
  page.drawLine({ start: { x: midX + 10, y }, end: { x: midX + 210, y }, thickness: 1, color: rgb(0, 0, 0) });
  y -= 14;
  page.drawText(v.razao_social.substring(0, 35), { x: mL, y, font: fontBold, size: 9, color: rgb(0, 0, 0) });
  page.drawText(v.nome_contratante.substring(0, 35), { x: midX + 10, y, font: fontBold, size: 9, color: rgb(0, 0, 0) });
  y -= 12;
  page.drawText(`CNPJ: ${v.cnpj_prestadora}`, { x: mL, y, font: fontNormal, size: 8.5, color: rgb(0, 0, 0) });
  page.drawText(`CPF/CNPJ: ${v.cpf_cnpj}`, { x: midX + 10, y, font: fontNormal, size: 8.5, color: rgb(0, 0, 0) });
  y -= 12;
  page.drawText(`Representante: ${v.nome_representante}`, { x: mL, y, font: fontNormal, size: 8.5, color: rgb(0, 0, 0) });

  return Buffer.from(await pdfDoc.save());
}

export async function enviarContrato(tenant, clienteWhatsapp, dados) {
  if (tenant.assinaturaTipo === 'zapsign') return enviarZapSign(tenant, clienteWhatsapp, dados);
  if (tenant.assinaturaTipo === 'd4sign') return enviarD4Sign(tenant, clienteWhatsapp, dados);
  throw new Error('Plataforma de assinatura digital não configurada para este provedor.');
}

async function enviarZapSign(tenant, clienteWhatsapp, dados) {
  const token = tenant.assinaturaToken;
  const templateToken = tenant.assinaturaExtra?.templateToken;
  if (!token)         throw new Error('Token ZapSign não configurado.');
  if (!templateToken) throw new Error('Token do modelo ZapSign não configurado.');

  const variables = buildVariables(tenant, clienteWhatsapp, dados);
  const varArray = Object.entries(variables).map(([name, value]) => ({ name, value: String(value) }));
  const fone = clienteWhatsapp.replace(/\D/g, '').replace(/^55/, '');

  const res = await fetch(
    `https://api.zapsign.com.br/api/v1/models/${templateToken}/create-doc/`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Contrato - ${dados.nome_contratante || clienteWhatsapp}`,
        variables: varArray,
        signers: [{
          name: dados.nome_contratante || 'Cliente',
          email: dados.email || '',
          phone_country: '55',
          phone_number: fone,
          send_automatic_email: !!dados.email,
          send_automatic_whatsapp: true,
        }],
        lang: 'pt-br',
      }),
    }
  );

  if (!res.ok) throw new Error(`ZapSign erro ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { uuid: data.token, linkAssinatura: data.signers?.[0]?.sign_url || null };
}

async function enviarD4Sign(tenant, clienteWhatsapp, dados) {
  const token     = tenant.assinaturaToken;
  const extra     = tenant.assinaturaExtra || {};
  const cofreUuid = extra.cofreUuid;
  const cryptKey  = extra.cryptKey;

  if (!token)     throw new Error('Token D4Sign não configurado.');
  if (!cofreUuid) throw new Error('UUID do cofre D4Sign não configurado.');

  const qs = `tokenAPI=${token}${cryptKey ? `&cryptKey=${cryptKey}` : ''}`;
  const v = buildVariables(tenant, clienteWhatsapp, dados);
  const nomeContratante = dados.nome_contratante || clienteWhatsapp;

  // 1. Gerar PDF do contrato com variáveis preenchidas
  const pdfBuffer = await gerarPdfContrato(v);

  // 2. Upload do PDF para o cofre D4Sign
  const form = new FormData();
  form.append('file', pdfBuffer, {
    filename: `Contrato - ${nomeContratante}.pdf`,
    contentType: 'application/pdf',
  });
  form.append('name_document', `Contrato - ${nomeContratante}`);

  const uploadRes = await fetch(
    `https://secure.d4sign.com.br/api/v1/documents/${cofreUuid}/upload?${qs}`,
    { method: 'POST', body: form, headers: form.getHeaders() }
  );

  const uploadText = await uploadRes.text();
  if (!uploadRes.ok) throw new Error(`D4Sign upload erro ${uploadRes.status}: ${uploadText}`);

  let uploadData;
  try { uploadData = JSON.parse(uploadText); } catch { throw new Error(`D4Sign resposta inválida: ${uploadText}`); }

  const docUuid = uploadData?.uuid;
  if (!docUuid) throw new Error(`D4Sign não retornou UUID. Resposta: ${uploadText}`);

  // 3. Adiciona signatário
  await fetch(`https://secure.d4sign.com.br/api/v1/documents/${docUuid}/createlist?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signers: [{
        email: dados.email || '',
        act: '1',
        foreign: '0',
        certificadoicpbr: '0',
        assinatura_presencial: '0',
        phonenumber: clienteWhatsapp.replace(/\D/g, ''),
        auth_pix: '0',
        auth_selfie: '0',
      }],
    }),
  });

  // 4. Envia para assinatura
  await fetch(`https://secure.d4sign.com.br/api/v1/documents/${docUuid}/sendtosigner?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Por favor, assine seu contrato de prestação de serviços de internet.' }),
  });

  return { uuid: docUuid, linkAssinatura: null };
}
