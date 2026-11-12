import React, { useState } from 'react';
import {
  Activity,
  Lock,
  Mail,
  Network,
  ShieldCheck,
  ArrowRight,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';

export const LoginView: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@neurolab.enterprise');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible iniciar sesión');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Panel de marca */}
        <div className="glass-panel rounded-3xl p-8 hidden lg:flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-rose-500/15 text-rose-500 border border-rose-500/30 shadow-[0_0_15px_rgba(225,29,72,0.35)] flex items-center justify-center">
                <Network className="w-5 h-5 text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
              </div>
              <div>
                <p className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">
                  NeuroLab{' '}
                  <span className="text-2xs uppercase font-mono px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-500 dark:text-rose-300 border border-rose-500/30">
                    Enterprise
                  </span>
                </p>
                <p className="text-xs text-zinc-600 dark:text-white/65">
                  Plataforma de aprendizaje profundo
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-semibold text-zinc-900 dark:text-white leading-tight">
                Diseño, entrenamiento y gobierno de redes neuronales
              </h1>
              <p className="text-sm text-zinc-600 dark:text-white/70 leading-relaxed">
                Plataforma con API FastAPI, workers aislados de TensorFlow/Keras, telemetría en
                tiempo real con recuperación de estado y registro inmutable de versiones.
              </p>
            </div>

            <ul className="space-y-3 text-sm text-zinc-600 dark:text-white/70">
              <li className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-rose-400" /> Autenticación JWT y RBAC por proyecto
              </li>
              <li className="flex items-center gap-2.5">
                <Activity className="w-4 h-4 text-rose-400" /> Telemetría SSE con replay desde PostgreSQL
              </li>
              <li className="flex items-center gap-2.5">
                <Lock className="w-4 h-4 text-rose-400" /> Modelos inmutables verificados con SHA-256
              </li>
            </ul>
          </div>

          <p className="text-2xs text-zinc-600 dark:text-white/65 font-mono">
            NeuroLab Enterprise Engine · v1.0.0
          </p>
          <div className="absolute -right-16 -bottom-16 w-64 h-64 rounded-full bg-rose-600/10 dark:bg-rose-600/20 blur-3xl pointer-events-none" />
        </div>

        {/* Formulario */}
        <div className="glass-panel rounded-3xl p-6 sm:p-8 space-y-6 flex flex-col justify-center">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white">Iniciar sesión</h2>
            <p className="text-sm text-zinc-600 dark:text-white/65 mt-1">
              Acceda con sus credenciales corporativas para continuar.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-sm font-medium text-zinc-700 dark:text-white/75 mb-1.5"
              >
                Correo electrónico
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-white/60" />
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full glass-input rounded-xl pl-10 pr-3 py-2.5 text-sm"
                  placeholder="usuario@empresa.com"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'login-error' : undefined}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-sm font-medium text-zinc-700 dark:text-white/75 mb-1.5"
              >
                Contraseña
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-white/60" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full glass-input rounded-xl pl-10 pr-11 py-2.5 text-sm"
                  placeholder="••••••••"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'login-error' : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-zinc-500 dark:text-white/65 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                id="login-error"
                role="alert"
                aria-live="assertive"
                className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-sm flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full glass-btn-primary rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Autenticando…' : 'Entrar a la plataforma'}
              {!submitting && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <p className="text-xs text-zinc-600 dark:text-white/65 leading-relaxed">
            El acceso está protegido con JWT y control de roles por proyecto. Si no tiene
            credenciales, solicítelas al administrador de la plataforma.
          </p>
        </div>
      </div>
    </div>
  );
};
