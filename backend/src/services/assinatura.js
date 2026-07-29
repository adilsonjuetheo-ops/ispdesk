import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import PizZip from 'pizzip';
import FormData from 'form-data';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function buildVariables(tenant, clienteWhatsapp, dados) {
  const hoje = new Date();
  const endPrestadora = [tenant.endereco, tenant.cidade, tenant.uf, tenant.cep]
    .filter(Boolean).join(', ');

  return {
    // Prestadora (auto do tenant)
    razao_social:          tenant.nome || '',
    cnpj_prestadora:       tenant.cnpj || '',
    endereco_prestadora:   endPrestadora,
    numero_anatel:         dados.numero_anatel || '',
    telefone_suporte:      tenant.telefone || '',
    email_suporte:         tenant.email || '',
    site:                  tenant.website || '',
    atendimento_presencial: dados.atendimento_presencial || 'Não disponível',
    horario_atendimento:   dados.horario_atendimento || '',
    canal_lgpd:            dados.canal_lgpd || tenant.email || '',
    url_privacidade:       dados.url_privacidade || tenant.website || '',
    cidade_foro:           dados.cidade_foro || tenant.cidade || '',
    uf:                    dados.uf || tenant.uf || '',
    cidade_assinatura:     dados.cidade_foro || tenant.cidade || '',
    dia_assinatura:        String(hoje.getDate()).padStart(2, '0'),
    mes_assinatura:        MESES[hoje.getMonth()],
    ano_assinatura:        String(hoje.getFullYear()),
    nome_representante:    dados.nome_representante || '',

    // Cliente (do formulário)
    nome_contratante:      dados.nome_contratante || '',
    cpf_cnpj:              dados.cpf_cnpj || '',
    rg:                    dados.rg || 'N/A',
    endereco_contratante:  dados.endereco_contratante || '',
    telefone:              clienteWhatsapp.replace(/\D/g, ''),
    email:                 dados.email || '',

    // Plano (do formulário)
    identificacao_oferta:  dados.identificacao_oferta || '',
    tecnologia:            dados.tecnologia || '',
    velocidade_download:   dados.velocidade_download || '',
    velocidade_upload:     dados.velocidade_upload || '',
    mensalidade:           dados.mensalidade || '',
    taxa_instalacao:       dados.taxa_instalacao || '0,00',
    dia_vencimento:        dados.dia_vencimento || '',
    franquia:              dados.franquia || 'Ilimitada',
    endereco_instalacao:   dados.endereco_instalacao || dados.endereco_contratante || '',
    tipo_ip:               dados.tipo_ip || 'Dinâmico',
    equipamentos:          dados.equipamentos || '',
    prazo_instalacao:      dados.prazo_instalacao || '7',
    prazo_permanencia:     dados.prazo_permanencia || 'Sem fidelidade',
    beneficio_permanencia: dados.beneficio_permanencia || 'N/A',
    numero_oferta_anatel:  dados.numero_oferta_anatel || 'N/A',
    forma_pagamento:       dados.forma_pagamento || '',
    modalidade_equipamento: dados.modalidade_equipamento || 'comodato',
    valor_equipamento:     dados.valor_equipamento || '0,00',
    valor_reposicao:       dados.valor_reposicao || '0,00',

    // Fidelidade (opcional)
    descricao_beneficio:   dados.descricao_beneficio || 'N/A',
    valor_beneficio:       dados.valor_beneficio || '0,00',
    meses_permanencia:     dados.meses_permanencia || '0',
  };
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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ZapSign erro ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    uuid: data.token,
    linkAssinatura: data.signers?.[0]?.sign_url || null,
  };
}

function fillDocxTemplate(templateBuffer, variables) {
  const zip = new PizZip(templateBuffer);
  const xmlParts = ['word/document.xml', 'word/header1.xml', 'word/header2.xml', 'word/footer1.xml', 'word/footer2.xml'];

  for (const part of xmlParts) {
    if (!zip.files[part]) continue;
    let content = zip.files[part].asText();
    for (const [key, value] of Object.entries(variables)) {
      content = content.replaceAll(`{{${key}}}`, String(value));
    }
    zip.file(part, content);
  }

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function enviarD4Sign(tenant, clienteWhatsapp, dados) {
  const token     = tenant.assinaturaToken;
  const extra     = tenant.assinaturaExtra || {};
  const cofreUuid = extra.cofreUuid;
  const cryptKey  = extra.cryptKey;

  if (!token)     throw new Error('Token D4Sign não configurado.');
  if (!cofreUuid) throw new Error('UUID do cofre D4Sign não configurado.');

  const qs = `tokenAPI=${token}${cryptKey ? `&cryptKey=${cryptKey}` : ''}`;
  const nomeContratante = dados.nome_contratante || clienteWhatsapp;

  // 1. Preencher variáveis no template DOCX via substituição direta no XML
  const variables = buildVariables(tenant, clienteWhatsapp, dados);
  const templatePath = join(__dirname, '../templates/contrato_scm.docx');
  const templateBuffer = readFileSync(templatePath);
  const filledBuffer = fillDocxTemplate(templateBuffer, variables);

  // 2. Upload do DOCX preenchido para o D4Sign
  const form = new FormData();
  form.append('file-upload', filledBuffer, {
    filename: `Contrato - ${nomeContratante}.docx`,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  form.append('name_document', `Contrato - ${nomeContratante}`);

  const uploadRes = await fetch(
    `https://secure.d4sign.com.br/api/v1/documents/${cofreUuid}/upload?${qs}`,
    {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    }
  );

  const uploadText = await uploadRes.text();
  if (!uploadRes.ok) {
    throw new Error(`D4Sign upload erro ${uploadRes.status}: ${uploadText}`);
  }

  let uploadData;
  try { uploadData = JSON.parse(uploadText); } catch {
    throw new Error(`D4Sign upload resposta inválida: ${uploadText}`);
  }

  const docUuid = uploadData?.uuid;
  if (!docUuid) {
    throw new Error(`D4Sign não retornou UUID do documento. Resposta: ${uploadText}`);
  }

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
