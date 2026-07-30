import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import api from '../lib/api.js';
import { Loader2 } from 'lucide-react';

const features = [
  { icon: '🤖', label: 'IA que responde automaticamente' },
  { icon: '📝', label: 'Contratos digitais integrados' },
  { icon: '👥', label: 'Multi-agentes e filiais' },
];

function ChatMockup() {
  return (
    <div className="w-full max-w-xs bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 bg-white/10 border-b border-white/15">
        <div className="w-8 h-8 rounded-full bg-white/25 flex items-center justify-center text-sm">👤</div>
        <div>
          <p className="text-white text-sm font-medium leading-none">Maria Silva</p>
          <p className="text-blue-200 text-[11px] mt-0.5">digitando...</p>
        </div>
        <div className="ml-auto flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-white/30" />
          <div className="w-2 h-2 rounded-full bg-white/30" />
          <div className="w-2 h-2 rounded-full bg-white/30" />
        </div>
      </div>

      {/* Messages */}
      <div className="px-4 py-3 space-y-3">
        {/* Client */}
        <div className="flex gap-2 items-end">
          <div className="w-6 h-6 rounded-full bg-white/20 shrink-0" />
          <div className="bg-white/15 rounded-xl rounded-bl-sm px-3 py-2 text-white text-xs max-w-[75%]">
            Olá! Gostaria de saber sobre os planos disponíveis.
          </div>
        </div>

        {/* Bot */}
        <div className="flex gap-2 items-end flex-row-reverse">
          <div className="w-6 h-6 rounded-full bg-blue-300/40 shrink-0" />
          <div className="bg-blue-400/40 rounded-xl rounded-br-sm px-3 py-2 text-white text-xs max-w-[75%]">
            Olá, Maria! Vou te apresentar nossas melhores opções. 😊
          </div>
        </div>

        {/* Client 2 */}
        <div className="flex gap-2 items-end">
          <div className="w-6 h-6 rounded-full bg-white/20 shrink-0" />
          <div className="bg-white/15 rounded-xl rounded-bl-sm px-3 py-2 text-white text-xs max-w-[75%]">
            Quero assinar o plano agora!
          </div>
        </div>

        {/* Typing */}
        <div className="flex gap-2 items-center">
          <div className="w-6 h-6 rounded-full bg-blue-300/40 shrink-0" />
          <div className="bg-blue-400/40 rounded-xl px-3 py-2 flex gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-2 px-4 py-3 bg-white/10 border-t border-white/15">
        <div className="flex-1 bg-white/15 rounded-lg px-3 py-1.5 text-white/50 text-xs">
          Escreva sua resposta...
        </div>
        <div className="w-7 h-7 rounded-lg bg-blue-400/50 flex items-center justify-center text-white text-xs">➤</div>
      </div>
    </div>
  );
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async e => {
    e.preventDefault();
    setErro('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, senha });
      login(data.token, data.user);
      if (data.user.role === 'superadmin') {
        navigate('/admin/dashboard');
      } else {
        navigate('/inbox');
      }
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">

      {/* Left panel */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 flex-col items-center justify-center p-14 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -left-20 w-[28rem] h-[28rem] rounded-full bg-blue-900/30" />
        <div className="absolute top-1/2 right-8 w-40 h-40 rounded-full bg-white/5" />

        <div className="relative z-10 w-full max-w-sm flex flex-col items-center text-center">
          {/* Headline */}
          <h1 className="text-3xl font-bold text-white leading-snug mb-3">
            Atendimento inteligente pelo WhatsApp
          </h1>
          <p className="text-blue-100 text-sm leading-relaxed mb-8">
            IA que responde, contratos digitais e gestão de equipe — tudo em uma única plataforma.
          </p>

          {/* Features */}
          <div className="w-full space-y-3 mb-10">
            {features.map(f => (
              <div key={f.label} className="flex items-center gap-3 bg-white/10 rounded-xl px-4 py-2.5 border border-white/15">
                <span className="text-xl">{f.icon}</span>
                <span className="text-white text-sm font-medium">{f.label}</span>
              </div>
            ))}
          </div>

          {/* Chat mockup */}
          <ChatMockup />
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center bg-white px-8">
        <div className="w-full max-w-sm">

          {/* Logo */}
          <div className="flex justify-center mb-8">
            <img src="/logoisp.png" alt="Logo" className="h-16 rounded-2xl" />
          </div>

          {/* Heading */}
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Entrar</h2>
          <p className="text-gray-500 text-sm mb-7">Insira seus dados de acesso para continuar.</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="seu@email.com"
                className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm transition-shadow"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Senha</label>
              <input
                type="password"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm transition-shadow"
              />
            </div>

            {erro && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 text-red-700 text-sm">
                {erro}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <p className="text-center text-gray-400 text-xs mt-10">
            © {new Date().getFullYear()} — Todos os direitos reservados
          </p>
        </div>
      </div>

    </div>
  );
}
