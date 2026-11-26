import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import api from '../lib/api.js';
import {
  Loader2, Mail, Lock, Eye, EyeOff, ArrowRight, Bot, FileSignature, Users,
  ShieldCheck, Wifi, CheckCheck, Sparkles,
} from 'lucide-react';

const features = [
  { icon: Bot, titulo: 'IA que atende 24 horas', desc: '2ª via, desbloqueio e dúvidas resolvidos sem fila.' },
  { icon: FileSignature, titulo: 'Contratos digitais', desc: 'Adesão assinada pelo celular, direto na conversa.' },
  { icon: Users, titulo: 'Equipe e filiais', desc: 'Fila, transferência e relatórios em um só lugar.' },
];

// Animações só desta tela — entrada suave dos blocos e das mensagens do
// mockup. Quem pediu menos movimento no sistema não vê nenhuma.
const estilos = `
@keyframes login-sobe { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes login-flutua { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
.login-sobe { opacity: 0; animation: login-sobe .6s ease-out forwards; }
.login-flutua { animation: login-flutua 6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .login-sobe { opacity: 1; animation: none; }
  .login-flutua { animation: none; }
}
`;

function Balao({ lado, atraso, children, hora }) {
  const doBot = lado === 'bot';
  return (
    <div
      className={`login-sobe flex ${doBot ? 'justify-end' : 'justify-start'}`}
      style={{ animationDelay: `${atraso}ms` }}
    >
      <div
        className={`max-w-[80%] px-3 py-2 text-[12.5px] leading-snug shadow-sm ${
          doBot
            ? 'bg-emerald-100 text-gray-800 rounded-2xl rounded-br-md'
            : 'bg-white text-gray-800 rounded-2xl rounded-bl-md'
        }`}
      >
        {children}
        <span className="flex items-center justify-end gap-1 text-[10px] text-gray-400 mt-0.5">
          {hora}
          {doBot && <CheckCheck className="w-3 h-3 text-sky-500" />}
        </span>
      </div>
    </div>
  );
}

function ChatMockup() {
  return (
    <div className="login-flutua w-full max-w-[340px] rounded-3xl overflow-hidden shadow-2xl shadow-blue-950/40 ring-1 ring-white/20">
      <div className="flex items-center gap-3 px-4 py-3 bg-[#0b5c4f]">
        <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center">
          <Wifi className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold leading-none">Seu Provedor</p>
          <p className="text-emerald-200 text-[11px] mt-1">online</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium text-white">
          <Sparkles className="w-3 h-3" /> IA
        </span>
      </div>

      <div className="bg-[#efe7dc] px-3 py-4 space-y-2.5">
        <Balao lado="cliente" atraso={300} hora="09:12">Oi, preciso da 2ª via da minha fatura</Balao>
        <Balao lado="bot" atraso={900} hora="09:12">
          Claro, Maria! Sua fatura de <b>R$ 99,90</b> vence dia 10. Aqui está o PIX copia e cola 👇
        </Balao>
        <Balao lado="cliente" atraso={1500} hora="09:14">Paguei, obrigada! 🙏</Balao>
        <Balao lado="bot" atraso={2100} hora="09:14">Obrigado pelo pagamento! 😊 A baixa aparece em instantes.</Balao>
      </div>
    </div>
  );
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
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

  const campo = 'w-full rounded-xl border border-gray-200 bg-gray-50/70 pl-11 pr-3.5 py-3 text-sm text-gray-900 placeholder-gray-400 transition focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/15';

  return (
    <div className="min-h-screen flex bg-white">
      <style>{estilos}</style>

      {/* Painel da marca */}
      <div className="hidden lg:flex w-1/2 relative overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-700 to-slate-900 items-center justify-center p-12">
        {/* Grade e brilhos de fundo */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
          }}
        />
        <div className="absolute -top-32 -left-24 w-[30rem] h-[30rem] rounded-full bg-sky-400/30 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 w-[32rem] h-[32rem] rounded-full bg-emerald-400/20 blur-3xl" />

        <div className="relative z-10 w-full max-w-md flex flex-col items-center">
          <div className="w-full">
            <span className="login-sobe inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-blue-50 backdrop-blur">
              <Wifi className="w-3.5 h-3.5" /> Feito para provedores de internet
            </span>

            <h1 className="login-sobe mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white" style={{ animationDelay: '100ms' }}>
              Atendimento inteligente
              <span className="block bg-gradient-to-r from-sky-300 to-emerald-300 bg-clip-text text-transparent">
                pelo WhatsApp
              </span>
            </h1>
            <p className="login-sobe mt-4 text-[15px] leading-relaxed text-blue-100/90" style={{ animationDelay: '200ms' }}>
              Seu cliente resolve na hora, sua equipe cuida só do que precisa de gente.
            </p>

            <ul className="mt-7 space-y-3.5">
              {features.map((f, i) => (
                <li key={f.titulo} className="login-sobe flex items-start gap-3.5" style={{ animationDelay: `${300 + i * 100}ms` }}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
                    <f.icon className="w-5 h-5 text-sky-200" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{f.titulo}</p>
                    <p className="text-[13px] text-blue-100/75">{f.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Só cabe inteiro em tela alta; em notebook baixo o texto basta. */}
          <div className="hidden [@media(min-height:860px)]:flex w-full justify-center mt-10">
            <ChatMockup />
          </div>
        </div>
      </div>

      {/* Formulário */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <div className="login-sobe flex justify-center mb-10">
            <img src="/logoisp.png" alt="ISPDesk" className="h-20 rounded-2xl" />
          </div>

          <h2 className="login-sobe text-2xl font-bold tracking-tight text-gray-900" style={{ animationDelay: '80ms' }}>
            Bem-vindo de volta 👋
          </h2>
          <p className="login-sobe mt-1.5 mb-8 text-sm text-gray-500" style={{ animationDelay: '120ms' }}>
            Entre com seu e-mail e senha para acessar o painel.
          </p>

          <form onSubmit={handleSubmit} className="login-sobe space-y-5" style={{ animationDelay: '180ms' }}>
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1.5">E-mail</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="seu@email.com"
                  className={campo}
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-senha" className="block text-sm font-medium text-gray-700 mb-1.5">Senha</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400" />
                <input
                  id="login-senha"
                  type={verSenha ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  required
                  placeholder="••••••••"
                  className={`${campo} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setVerSenha(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                  aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  title={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {verSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {erro && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {erro}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:shadow-xl hover:shadow-blue-600/30 hover:brightness-110 active:brightness-95 disabled:opacity-60"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Entrando...</>
                : <>Entrar <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" /></>}
            </button>
          </form>

          <p className="login-sobe mt-6 flex items-center justify-center gap-1.5 text-xs text-gray-400" style={{ animationDelay: '240ms' }}>
            <ShieldCheck className="w-3.5 h-3.5" /> Conexão segura e criptografada
          </p>

          <p className="mt-12 text-center text-xs text-gray-400">
            © {new Date().getFullYear()} ISPDesk — Todos os direitos reservados
          </p>
        </div>
      </div>
    </div>
  );
}
