import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import FormData from 'form-data';
import fetch from 'node-fetch';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

export function buildVariables(tenant, clienteWhatsapp, dados) {
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

    // --- Link dedicado ---
    // Qual modelo de contrato gerar. O residencial é o padrão de propósito:
    // provedor que não pediu nada continua recebendo exatamente o que recebia.
    modelo_contrato:        dados.modelo_contrato === 'dedicado' ? 'dedicado' : 'residencial',
    tipo_servico:           dados.tipo_servico || 'IP Dedicado',
    ie:                     dados.ie || 'Isento',
    contato_comercial:      dados.contato_comercial || dados.telefone || '',
    switch_conversor:       dados.switch_conversor || 'A definir na vistoria',
    roteador:               dados.roteador || 'A definir na vistoria',
    taxa_locacao:           dados.taxa_locacao || '0,00',
    consumo_minimo:         dados.consumo_minimo || dados.mensalidade || '',
    sla_percentual:         dados.sla_percentual || '99,0',
    prazo_reparo:           dados.prazo_reparo || '24 (vinte e quatro) a 48 (quarenta e oito) horas',
    dias_suspensao:         dados.dias_suspensao || '10 (dez)',
    dias_rescisao:          dados.dias_rescisao || '60 (sessenta)',

    // --- Permanência (fidelidade) ---
    // A multa por quebra de fidelidade é proporcional ao tempo que falta e
    // limitada ao benefício concedido — não é um valor cheio. É o que a
    // Resolução ANATEL 632/2014 exige, e cobrar diferente disso é o tipo de
    // cláusula que cai no Procon.
    meses_permanencia:      String(dados.meses_permanencia || '12'),
    beneficio_fidelidade:   dados.beneficio_fidelidade || 'isenção da taxa de instalação',
    valor_beneficio:        dados.valor_beneficio || dados.taxa_instalacao || '0,00',
  };
}

// Contrato de link dedicado, na estrutura do modelo que a StaNet já usa em
// papel. Os números que mudam de cliente para cliente — velocidade, valor,
// prazos — saem das variáveis; antes eram digitados à mão em cima de um PDF
// que ainda trazia o nome do cliente anterior no rodapé.
function clausulasDedicado(v) {
  return [
    ['CLÁUSULA 1ª — DEFINIÇÕES', [
      `SCM: Serviço de Comunicação Multimídia, serviço fixo de telecomunicações de interesse coletivo, prestado em regime privado nos termos do Regulamento aprovado pela Resolução ANATEL n.º 614/2013.`,
      `CONTRATANTE: pessoa natural ou jurídica que firma o presente contrato. CONTRATADA: ${v.razao_social}.`,
      `Central de Atendimento: ${v.telefone_suporte}, responsável por reclamações, solicitações de informação e de serviços.`,
      `RGC: Regulamento Geral de Direitos do Consumidor de Serviços de Telecomunicações, aprovado pela Resolução ANATEL n.º 632/2014.`,
      `Velocidade: capacidade de transmissão expressa em bits por segundo, medida conforme regulamentação específica.`,
    ]],
    ['CLÁUSULA 2ª — OBJETO', [
      `Prestação de Serviço de Comunicação Multimídia de âmbito nacional e internacional, na modalidade ${v.tipo_servico}, para tráfego de voz, dados e imagens, utilizando a rede de telecomunicações da CONTRATADA.`,
      `São partes integrantes deste Contrato, independentemente de transcrição: Anexo I — SLA; Anexo II — Termo de Contratação de Serviços; e Anexo III — Contrato de Permanência, quando houver prazo determinado.`,
      `A CONTRATANTE não concede exclusividade à CONTRATADA, podendo contratar outro fornecedor para o mesmo serviço.`,
    ]],
    ['CLÁUSULA 3ª — PRESTAÇÃO DO SERVIÇO', [
      `Provimento ininterrupto na modalidade SCM, 24 (vinte e quatro) horas por dia, 7 (sete) dias por semana, observado o Anexo I — SLA.`,
      `Acesso dedicado via cabo de fibra óptica da CONTRATADA, fornecido após constatação de viabilidade técnica e realização de vistoria.`,
      `A CONTRATADA não dispõe de mecanismos de segurança lógica da rede interna da CONTRATANTE, sendo desta a responsabilidade pela preservação de seus dados e pelo controle de acesso à sua rede.`,
      `A CONTRATADA não responde pelo conteúdo das informações trafegadas nem pelo uso indevido da rede, de responsabilidade exclusiva da CONTRATANTE.`,
    ]],
    ['CLÁUSULA 4ª — EQUIPAMENTOS', [
      `Equipamentos cedidos em regime de ${v.modalidade_equipamento}: ${v.equipamentos}.`,
      `A partir da entrega, a CONTRATANTE responde pela guarda e integridade dos equipamentos, vedada modificação, desconexão ou reconfiguração sem anuência escrita da CONTRATADA.`,
      `Extinto o contrato, os equipamentos serão devolvidos em perfeito estado, ressalvado o desgaste de uso normal, em até 5 (cinco) dias da solicitação. Em caso de extravio ou dano, a CONTRATANTE ressarcirá o valor de R$ ${v.valor_reposicao}.`,
      `A CONTRATADA garante o funcionamento até o conversor/switch óptico cedido, não respondendo por servidores, roteadores e redes wi-fi da CONTRATANTE.`,
      `A Taxa de Instalação é faturada uma única vez. A Taxa de Locação, quando houver, é faturada mensalmente.`,
    ]],
    ['CLÁUSULA 5ª — PREÇOS E CONDIÇÕES DE PAGAMENTO', [
      `• ${v.tipo_servico} — ${v.velocidade_download} Mbps download / ${v.velocidade_upload} Mbps upload: R$ ${v.mensalidade}/mês`,
      `• Taxa de instalação: R$ ${v.taxa_instalacao} | Taxa de locação de equipamentos: R$ ${v.taxa_locacao}/mês`,
      `• Consumo mínimo mensal: R$ ${v.consumo_minimo} | Vencimento: dia ${v.dia_vencimento} | Forma: ${v.forma_pagamento}`,
      `Para fins de cobrança considera-se a data de ativação. Atraso superior a 15 (quinze) dias por culpa exclusiva da CONTRATANTE faz a cobrança correr a partir da data de instalação.`,
      `O atraso no pagamento acarreta multa de 2% (dois por cento), juros de 1% (um por cento) ao mês pro rata e atualização monetária pelo IGP-M/FGV, ou pelo índice que vier a substituí-lo.`,
      `Não sanada a inadimplência em ${v.dias_suspensao} dias da notificação de vencimento, a CONTRATADA poderá suspender parcial ou totalmente o serviço, restabelecido mediante pagamento com os acréscimos devidos.`,
      `Não sanada em até ${v.dias_rescisao} dias do início da suspensão, a CONTRATADA poderá rescindir o contrato, sem prejuízo do protesto do título e da inscrição do débito nos órgãos de proteção ao crédito.`,
    ]],
    ['CLÁUSULA 6ª — REAJUSTE', [
      `Os preços serão corrigidos a cada 12 (doze) meses pelo IGP-M/FGV, ou por índice oficial que vier a substituí-lo, mediante comunicação à CONTRATANTE com 30 (trinta) dias de antecedência.`,
    ]],
    ['CLÁUSULA 7ª — VIGÊNCIA E PERMANÊNCIA', [
      `O contrato entra em vigor na data da assinatura e vigora enquanto houver obrigações entre as partes, conforme o Anexo II — Termo de Contratação de Serviços.`,
      `Prazo de permanência mínima: ${v.meses_permanencia} meses, nas condições do Anexo III — Contrato de Permanência.`,
      `Renovação por iguais e sucessivos períodos, salvo denúncia escrita por qualquer das partes com 30 (trinta) dias de antecedência.`,
    ]],
    ['CLÁUSULA 8ª — DIREITOS E OBRIGAÇÕES DA CONTRATANTE', [
      `São direitos da CONTRATANTE, nos termos do RGC: acesso e fruição do serviço nos padrões de qualidade contratados; liberdade de escolha de prestadora e plano; inviolabilidade e segredo das comunicações; privacidade no tratamento de seus dados; resposta tempestiva a reclamações; encaminhamento de reclamação à ANATEL ou aos órgãos de defesa do consumidor; reparação por danos; restabelecimento do serviço a partir da quitação do débito; suspensão temporária sem ônus, uma vez a cada doze meses, por prazo de 30 a 120 dias; e rescisão a qualquer tempo, sem prejuízo das condições de permanência do Anexo III.`,
      `Obriga-se a CONTRATANTE a: pagar pontualmente; zelar pelos equipamentos cedidos e prover-lhes local e energia adequados; conectar à rede apenas terminais certificados pela ANATEL; franquear acesso identificado de prepostos da CONTRATADA para manutenção; comunicar de imediato roubo, extravio ou alteração cadastral; e não revender o serviço nem cedê-lo a terceiros.`,
    ]],
    ['CLÁUSULA 9ª — DIREITOS E OBRIGAÇÕES DA CONTRATADA', [
      `A CONTRATADA prestará o serviço segundo os padrões de qualidade da regulamentação, manterá central de atendimento acessível sem custo à CONTRATANTE no mínimo das 8h às 20h em dias úteis (${v.telefone_suporte}), comunicará previamente as interrupções programadas com no mínimo 72 (setenta e duas) horas de antecedência e zelará pelo sigilo dos dados e registros de conexão.`,
      `A CONTRATADA não condicionará a oferta do SCM à aquisição de outro serviço, não impedirá que a CONTRATANTE seja atendida por outras redes e prestará à ANATEL as informações que lhe forem requeridas.`,
      `Os dados cadastrais e os registros de conexão serão mantidos pelo prazo mínimo de 1 (um) ano, nos termos do Marco Civil da Internet (Lei 12.965/2014).`,
    ]],
    ['CLÁUSULA 10ª — CONTESTAÇÃO DE DÉBITOS', [
      `A CONTRATANTE pode contestar valores no prazo de 3 (três) anos da cobrança considerada indevida, nos termos dos artigos 81 e seguintes do RGC. O valor contestado tem a cobrança suspensa, e os valores não contestados podem ser pagos em novo documento emitido sem ônus.`,
    ]],
    ['CLÁUSULA 11ª — CONCESSÃO DE CRÉDITOS', [
      `Em caso de interrupção ou degradação originada na rede da CONTRATADA, será descontado da assinatura o valor proporcional ao período, excetuadas as interrupções programadas e as decorrentes de caso fortuito, força maior ou culpa da CONTRATANTE.`,
      `A contagem do tempo inicia-se no registro da ocorrência. O desconto será aplicado no documento de cobrança seguinte.`,
    ]],
    ['CLÁUSULA 12ª — CASO FORTUITO E FORÇA MAIOR', [
      `Não gera responsabilidade da CONTRATADA o atraso ou a falta de cumprimento de obrigação motivados por caso fortuito ou força maior, nos termos do artigo 393 do Código Civil.`,
    ]],
    ['CLÁUSULA 13ª — RESCISÃO', [
      `Qualquer das partes poderá rescindir o contrato por inadimplemento da outra, mediante comunicação expressa, ou em caso de recuperação judicial, falência ou insolvência.`,
      `A rescisão antecipada e sem justa causa pela CONTRATANTE, durante o prazo de permanência, sujeita-se à multa proporcional prevista no Anexo III — Contrato de Permanência, mediante notificação prévia de 30 (trinta) dias.`,
      `A rescisão não exime as partes das obrigações vencidas, notadamente o pagamento dos valores devidos e a devolução dos equipamentos.`,
    ]],
    ['CLÁUSULA 14ª — PARÂMETROS DE QUALIDADE', [
      `Disponibilidade conforme o Anexo I — SLA; fornecimento de sinais nas características da regulamentação; divulgação prévia de alterações de preços e condições; e rapidez no atendimento a solicitações e reclamações.`,
    ]],
    ['CLÁUSULA 15ª — PROTEÇÃO DE DADOS PESSOAIS (LGPD)', [
      `As partes tratarão dados pessoais nos termos da Lei n.º 13.709/2018, apenas para as finalidades da execução deste contrato e pelo tempo necessário, com acesso restrito a quem tenha necessidade legítima.`,
      `Ocorrido incidente de segurança, a parte que lhe der causa notificará prontamente a outra, informando a natureza da violação, os dados potencialmente afetados, a duração e as medidas de mitigação adotadas.`,
      `Canal do titular para exercício de direitos: ${v.canal_lgpd}. Política de Privacidade: ${v.url_privacidade}.`,
    ]],
    ['CLÁUSULA 16ª — LEGISLAÇÃO E CANAIS DE RECLAMAÇÃO', [
      `Aplicam-se a Lei Geral de Telecomunicações (Lei 9.472/1997), o Regulamento do SCM (Res. ANATEL 614/2013), o RGC (Res. ANATEL 632/2014) e, quando a CONTRATANTE for consumidora final, o Código de Defesa do Consumidor (Lei 8.078/1990).`,
      `Não atendida a reclamação pela CONTRATADA, a CONTRATANTE pode recorrer à ANATEL pelo telefone 1331 (1332 para deficientes auditivos) ou ao portal www.consumidor.gov.br.`,
    ]],
    ['CLÁUSULA 17ª — DISPOSIÇÕES GERAIS', [
      `A ativação fica sujeita a viabilidade técnica e à análise dos documentos da CONTRATANTE. Qualquer alteração das condições será formalizada por termo aditivo.`,
      `O contrato não pode ser cedido sem anuência escrita da outra parte, dispensada essa anuência em caso de reorganização societária da CONTRATADA.`,
      `A tolerância quanto ao exercício de qualquer direito não implica renúncia nem novação.`,
      `As partes são independentes entre si, não se criando vínculo empregatício entre elas ou seus empregados.`,
      `Atendimento ao assinante: ${v.telefone_suporte} | ${v.email_suporte} | ${v.site}`,
    ]],
    ['CLÁUSULA 18ª — FORO', [
      `Fica eleito o foro da Comarca de ${v.cidade_foro} — ${v.uf}, com renúncia a qualquer outro, por mais privilegiado que seja.`,
    ]],
  ];
}

// Anexos do link dedicado. O Anexo III é o que faltava: o contrato em papel
// remete a ele na cláusula de rescisão ("multa conforme Anexo III: Contrato de
// Permanência"), mas o documento não trazia anexo nenhum — a fidelidade era
// citada e nunca definida, o que na prática torna a multa incobrável.
function anexosDedicado(v) {
  const meses = Number(v.meses_permanencia) || 12;
  return [
    ['ANEXO I — ACORDO DE NÍVEL DE SERVIÇO (SLA)', [
      `1. Entende-se por SLA o nível de desempenho técnico do serviço prestado, aplicável à manutenção e reparo da rede de transmissão de dados objeto deste contrato.`,
      `2. A CONTRATADA propõe-se a manter, em cada mês civil, disponibilidade da ordem de ${v.sla_percentual}%.`,
      `3. Excluem-se da apuração do SLA: manutenções pré-programadas; falhas provocadas por equipamentos ou falta de energia na CONTRATANTE; caso fortuito e força maior; distúrbios públicos, atos de guerra ou vandalismo; e interrupções provocadas por servidores de sites de terceiros.`,
      `4. Havendo defeito, interrupção ou queda de qualidade, a CONTRATANTE abrirá chamado pelos canais da Cláusula 1ª, e esse registro marca o início da contagem para fins de disponibilidade e de eventual crédito.`,
      `5. Prazos máximos de reparo, conforme a natureza do problema: (a) detecção, análise e notificação à CONTRATANTE: ${v.prazo_reparo}; (b) reparo de falhas na infraestrutura da CONTRATADA: ${v.prazo_reparo}; (c) reparo de falhas na infraestrutura de fornecedores da CONTRATADA: ${v.prazo_reparo}. Ressalvam-se os casos que dependam de terceiros, como substituição de posteamento pela concessionária de energia.`,
      `6. Em interrupção atribuível exclusiva e comprovadamente à CONTRATADA, será concedido crédito proporcional ao período, lançado em documento de cobrança, na forma da Cláusula 11ª.`,
      `7. Descumpridos os índices de SLA por 3 (três) meses consecutivos, a CONTRATANTE poderá pedir a rescisão motivada do contrato, sem incidência da multa do Anexo III.`,
    ]],
    ['ANEXO II — TERMO DE CONTRATAÇÃO DE SERVIÇOS', [
      `CONTRATANTE: ${v.nome_contratante} | CPF/CNPJ: ${v.cpf_cnpj} | Inscrição Estadual: ${v.ie}`,
      `Endereço: ${v.endereco_contratante}`,
      `Endereço de instalação: ${v.endereco_instalacao}`,
      `Contato comercial: ${v.contato_comercial} | E-mail: ${v.email}`,
      ``,
      `CONFIGURAÇÃO DOS SERVIÇOS`,
      `Serviço: ${v.tipo_servico} | Tecnologia: ${v.tecnologia}`,
      `Velocidade: ${v.velocidade_download} Mbps download / ${v.velocidade_upload} Mbps upload`,
      `Tipo de IP: ${v.tipo_ip} | Franquia: ${v.franquia}`,
      `Infraestrutura: rede de fibra óptica até a última milha`,
      `Switch/Conversor: ${v.switch_conversor} | Roteador: ${v.roteador}`,
      `Equipamentos: ${v.equipamentos} (em ${v.modalidade_equipamento})`,
      `Prazo de instalação: até ${v.prazo_instalacao} dias úteis da assinatura`,
      ``,
      `CONDIÇÕES COMERCIAIS`,
      `Mensalidade do serviço: R$ ${v.mensalidade}`,
      `Locação de equipamentos: R$ ${v.taxa_locacao}`,
      `Taxa de instalação: R$ ${v.taxa_instalacao}`,
      `Consumo mínimo mensal: R$ ${v.consumo_minimo}`,
      `Vencimento da fatura: dia ${v.dia_vencimento} | Forma de pagamento: ${v.forma_pagamento}`,
      `Permanência mínima: ${meses} meses (Anexo III)`,
      `Identificação da oferta: ${v.identificacao_oferta} | N.º ANATEL: ${v.numero_oferta_anatel}`,
    ]],
    ['ANEXO III — CONTRATO DE PERMANÊNCIA', [
      `1. Em contrapartida ao benefício concedido pela CONTRATADA — ${v.beneficio_fidelidade}, no valor de R$ ${v.valor_beneficio} —, a CONTRATANTE compromete-se a permanecer vinculada ao serviço pelo prazo de ${meses} (${meses === 12 ? 'doze' : meses}) meses, contados da data de ativação.`,
      `2. Cumprido o prazo, o contrato segue por tempo indeterminado, sem nova permanência e sem qualquer ônus para a CONTRATANTE.`,
      `3. Havendo rescisão sem justa causa por iniciativa da CONTRATANTE antes do término do prazo, será devida multa calculada de forma PROPORCIONAL ao tempo restante, na seguinte fórmula:`,
      `      Multa = R$ ${v.valor_beneficio} × (meses restantes ÷ ${meses})`,
      `4. A multa jamais excederá o valor do benefício concedido e reduz-se a cada mês cumprido, chegando a zero no último mês, nos termos do artigo 58 do RGC (Resolução ANATEL n.º 632/2014).`,
      `5. NÃO incide multa, e a rescisão é considerada motivada, quando decorrer de: (a) descumprimento do SLA por 3 (três) meses consecutivos, na forma do Anexo I; (b) alteração unilateral de preços ou condições com a qual a CONTRATANTE não concorde; (c) impossibilidade técnica de a CONTRATADA prestar o serviço; ou (d) exercício do direito de arrependimento no prazo de 7 (sete) dias, nos termos do artigo 49 do Código de Defesa do Consumidor, quando a contratação houver ocorrido fora do estabelecimento ou por meio eletrônico.`,
      `6. A mudança de endereço dentro da área de cobertura da CONTRATADA não caracteriza rescisão e não gera multa, transferindo-se a permanência remanescente para o novo endereço.`,
      `7. A multa deste Anexo não se confunde com os valores já vencidos, com a devolução dos equipamentos cedidos nem com o ressarcimento previsto na Cláusula 4ª.`,
    ]],
  ];
}

export async function gerarPdfContrato(v) {
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
  drawText(v.modelo_contrato === 'dedicado' ? v.tipo_servico.toUpperCase() : 'ACESSO À INTERNET',
    { bold: true, size: 12, extraAfter: 6 });
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

  // O residencial segue sendo o padrão: provedor que não pediu nada continua
  // recebendo exatamente o contrato de antes.
  const clausulas = v.modelo_contrato === 'dedicado'
    ? clausulasDedicado(v)
    : [
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

  // Os anexos são parte do contrato e vão no mesmo arquivo, antes das
  // assinaturas: assinatura em documento separado deixa o anexo sem assinar,
  // que é justamente o que torna a multa de fidelidade discutível.
  if (v.modelo_contrato === 'dedicado') {
    for (const [titulo, itens] of anexosDedicado(v)) {
      newPage();
      drawText(titulo, { bold: true, size: 11, extraAfter: 6 });
      drawLine();
      for (const item of itens) {
        if (!item) { y -= 6; continue; }
        drawText(item, { size: 9.5, extraAfter: 2 });
      }
      y -= 4;
    }
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
  // Aceita tanto o UUID puro quanto a URL do painel que o D4Sign exibe e a
  // pessoa copia. Já veio salvo como URL em produção, e o erro resultante era
  // um 404 sem pista nenhuma do que estava errado.
  const cofreUuid = String(extra.cofreUuid || '')
    .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
    || extra.cofreUuid;
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
  const createRes = await fetch(`https://secure.d4sign.com.br/api/v1/documents/${docUuid}/createlist?${qs}`, {
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
  const createText = await createRes.text();
  if (!createRes.ok) throw new Error(`D4Sign createlist erro ${createRes.status}: ${createText}`);

  // 4. Envia para assinatura
  const sendRes = await fetch(`https://secure.d4sign.com.br/api/v1/documents/${docUuid}/sendtosigner?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Olá! Seu contrato de internet (${dados.identificacao_oferta || 'plano contratado'}) está pronto para assinatura digital. Por favor, assine para confirmar sua adesão.` }),
  });
  const sendText = await sendRes.text();
  if (!sendRes.ok) throw new Error(`D4Sign sendtosigner erro ${sendRes.status}: ${sendText}`);

  // 5. Busca o link de assinatura do signatário
  let linkAssinatura = null;
  try {
    const listRes = await fetch(`https://secure.d4sign.com.br/api/v1/documents/${docUuid}/list?${qs}`);
    if (listRes.ok) {
      const listData = await listRes.json();
      const signers = Object.values(listData);
      linkAssinatura = signers[0]?.link_shortner || null;
    }
  } catch {
    // link não crítico — contrato já foi enviado por e-mail
  }

  return { uuid: docUuid, linkAssinatura };
}

export async function buscarLinkAssinatura(tenant, uuid) {
  if (tenant.assinaturaTipo === 'd4sign') {
    const extra = tenant.assinaturaExtra || {};
    const qs = `tokenAPI=${tenant.assinaturaToken}${extra.cryptKey ? `&cryptKey=${extra.cryptKey}` : ''}`;
    try {
      const res = await fetch(`https://secure.d4sign.com.br/api/v1/documents/${uuid}/list?${qs}`);
      if (!res.ok) return null;
      const data = await res.json();
      return Object.values(data)[0]?.link_shortner || null;
    } catch { return null; }
  }
  if (tenant.assinaturaTipo === 'zapsign') {
    try {
      const res = await fetch(`https://api.zapsign.com.br/api/v1/docs/${uuid}/`, {
        headers: { Authorization: `Bearer ${tenant.assinaturaToken}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.signers?.[0]?.sign_url || null;
    } catch { return null; }
  }
  return null;
}
