export default function Privacidade() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Política de Privacidade</h1>
        <p className="text-sm text-gray-400 mb-8">ISPDesk — última atualização: junho de 2025</p>

        <section className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">1. Sobre o ISPDesk</h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            O ISPDesk é uma plataforma SaaS de atendimento via WhatsApp voltada para provedores de internet.
            Cada provedor (tenant) utiliza a plataforma para gerenciar conversas com seus clientes finais.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">2. Dados coletados</h2>
          <p className="text-gray-600 text-sm leading-relaxed mb-2">
            A plataforma coleta e armazena os seguintes dados:
          </p>
          <ul className="list-disc list-inside text-gray-600 text-sm space-y-1">
            <li>Número de WhatsApp dos clientes que iniciam contato com os provedores</li>
            <li>Conteúdo das mensagens trocadas nas conversas</li>
            <li>Nome e e-mail dos funcionários cadastrados pelos provedores</li>
            <li>Dados de configuração dos provedores (nome, CNPJ, token de API, etc.)</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">3. Uso dos dados</h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            Os dados são utilizados exclusivamente para:
          </p>
          <ul className="list-disc list-inside text-gray-600 text-sm space-y-1 mt-2">
            <li>Processar e exibir conversas de atendimento ao cliente</li>
            <li>Gerar respostas automáticas via inteligência artificial</li>
            <li>Autenticar funcionários dos provedores</li>
            <li>Integração com sistemas de gestão (SGP) configurados pelo provedor</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">4. Compartilhamento de dados</h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            Os dados <strong>não são vendidos ou compartilhados</strong> com terceiros, exceto:
          </p>
          <ul className="list-disc list-inside text-gray-600 text-sm space-y-1 mt-2">
            <li>Meta Platforms (WhatsApp Business API) — para envio e recebimento de mensagens</li>
            <li>Anthropic — para processamento das respostas de IA (somente o conteúdo das mensagens)</li>
            <li>Neon (banco de dados) — para armazenamento seguro dos dados</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">5. Retenção dos dados</h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            Os dados são mantidos enquanto o provedor tiver contrato ativo com o ISPDesk.
            Após o encerramento, os dados podem ser excluídos mediante solicitação formal.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">6. Segurança</h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            Todas as comunicações utilizam HTTPS/TLS. Senhas são armazenadas com hash bcrypt.
            Tokens de API são armazenados de forma criptografada.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">7. Direitos dos titulares</h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            Em conformidade com a LGPD (Lei 13.709/2018), os titulares podem solicitar acesso,
            correção ou exclusão de seus dados pelo e-mail: <strong>contato@adilsondev.com.br</strong>
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">8. Contato</h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            Dúvidas sobre esta política: <strong>contato@adilsondev.com.br</strong>
          </p>
        </section>
      </div>
    </div>
  );
}
