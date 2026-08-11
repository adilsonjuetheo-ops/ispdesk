import nodemailer from 'nodemailer';

function criarTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export async function enviarAlertaVencimento(provedores) {
  const transporter = criarTransporter();
  const destino = process.env.ALERTA_EMAIL;
  if (!transporter || !destino) {
    console.warn('[Email] SMTP não configurado — alerta de vencimento não enviado.');
    return;
  }

  const linhas = provedores.map(t => {
    const dias = Math.ceil((new Date(t.proximoVencimento) - new Date()) / 86_400_000);
    const status = dias < 0 ? '🔴 VENCIDO' : `🟡 vence em ${dias} dia(s)`;
    return `• ${t.nome} — ${status} (${new Date(t.proximoVencimento).toLocaleDateString('pt-BR')})`;
  }).join('\n');

  const assunto = `[ISPDesk] ${provedores.length} provedor(es) com mensalidade vencendo`;
  const texto = `Olá,\n\nOs seguintes provedores têm mensalidades vencidas ou com vencimento nos próximos 7 dias:\n\n${linhas}\n\nAcesse o painel para renovar manualmente:\nhttps://${process.env.FRONTEND_URL || 'ispdesk.com.br'}/admin/tenants\n\nISPDesk`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: destino,
    subject: assunto,
    text: texto,
  });

  console.log(`[Email] Alerta de vencimento enviado para ${destino} — ${provedores.length} provedor(es)`);
}
