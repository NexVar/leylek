import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, GATEWAY_URL } from '../api/client';
import { useMe, useRequestMagicLink } from '../api/hooks';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Logo } from '../components/Logo';
import { useAuthStore } from '../store/auth';

interface SendResult {
  email: string;
}

/**
 * Split-pane login. Brand hero on the left (navy with coral tagline),
 * auth form on the right. Google OAuth + magic-link via Resend.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const setUser = useAuthStore((s) => s.setUser);
  const requestMagicLink = useRequestMagicLink();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SendResult | null>(null);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  // If already logged in (e.g. arrived here after refresh with valid cookie),
  // bounce to the intended destination.
  useEffect(() => {
    if (me.data?.user) {
      setUser(me.data.user);
      navigate(redirectTo, { replace: true });
    }
  }, [me.data, navigate, redirectTo, setUser]);

  const requestSend = async (target: string) => {
    setError(null);
    const trimmed = target.trim();
    if (!trimmed) {
      setError('E-posta gerekli.');
      return;
    }
    try {
      await requestMagicLink.mutateAsync(trimmed);
      setSent({ email: trimmed });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 502
            ? 'Bağlantı gönderilemedi. E-posta sağlayıcısı şu an cevap vermiyor.'
            : err.message,
        );
      } else {
        setError('Bağlantı hatası. Gateway çalışıyor mu?');
      }
    }
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void requestSend(email);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-surface">
      {/* Brand hero — navy ground, coral accent on the tagline. */}
      <aside className="relative hidden lg:flex flex-col justify-between bg-primary text-primary-foreground p-12 overflow-hidden">
        {/* Subtle navy texture: layered dots, no gradient, no glassmorphism. */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, #FFFFFF 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />
        {/* Single coral corner accent — anchors the brand, doesn't bleed into copy. */}
        <div
          aria-hidden
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-accent/15 blur-[1px]"
        />

        <div className="relative z-10">
          <Logo tone="light" size="lg" />
        </div>

        <div className="relative z-10 flex flex-col gap-6 max-w-[460px]">
          <h1 className="text-display text-primary-foreground">
            Müşteriyi <span className="text-accent">Leylek getirir.</span>
          </h1>
          <p className="text-body-lg text-primary-foreground/70 max-w-prose">
            Reklamlarını 7/24 izleyen, zarar etmeye başlayanı kendi kapatan otonom bir ajan.
            Geleneksel dijital pazarlama ajanslarının onda biri kadar maliyetli, kat kat daha hızlı.
          </p>
          <ul className="flex flex-col gap-3 text-body-md text-primary-foreground/80">
            {[
              ['İçerik ajanı', '3 farklı strateji ile reklam üretir'],
              ['Optimizasyon ajanı', 'CPA 4× ortalamayı geçti mi otomatik durdurur'],
              ['Yayın ajanı', 'Meta + Google API’larına gerçek aksiyon atar'],
            ].map(([title, desc]) => (
              <li key={title} className="flex items-start gap-3">
                <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                <span>
                  <span className="font-semibold text-primary-foreground">{title}</span>
                  <span className="text-primary-foreground/60"> — {desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Auth form — surface, generous padding, single coral CTA. */}
      <section className="flex flex-col justify-start items-center px-5 pt-12 pb-10 sm:px-6 lg:justify-center lg:py-12">
        <div className="w-full max-w-[420px] flex flex-col gap-7 sm:gap-8">
          <div className="lg:hidden flex justify-start">
            <Logo size="md" />
          </div>

          <header className="flex flex-col gap-2">
            <h2 className="text-[28px] font-bold leading-[1.15] tracking-[-0.015em] text-ink sm:text-h1">
              Giriş yap
            </h2>
            <p className="text-body-md text-ink-muted">
              Otonom reklam ajanına hoş geldin. Google hesabınla bağlan veya e-postanı bırak, sana
              tek tıkla giriş bağlantısı gönderelim.
            </p>
          </header>

          {sent ? (
            <SentPanel
              result={sent}
              onResend={() => void requestSend(sent.email)}
              resending={requestMagicLink.isPending}
            />
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Input
                type="email"
                label="E-posta"
                autoComplete="email"
                placeholder="ornek@firmaniz.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={error ?? undefined}
                required
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                block
                loading={requestMagicLink.isPending}
              >
                {requestMagicLink.isPending ? 'Gönderiliyor…' : 'E-postaya giriş bağlantısı gönder'}
              </Button>
            </form>
          )}

          <div className="flex items-center gap-3 text-body-sm text-ink-subtle">
            <span className="flex-1 h-px bg-border" />
            veya
            <span className="flex-1 h-px bg-border" />
          </div>

          <a
            href={`${GATEWAY_URL}/api/auth/google/start`}
            className="w-full h-11 inline-flex items-center justify-center gap-2.5 rounded-md border border-primary text-primary bg-transparent hover:bg-primary/[0.04] transition-colors duration-150 text-[15px] font-medium"
          >
            <GoogleGlyph />
            Google ile Giriş Yap
          </a>

          <p className="text-body-sm text-ink-subtle">
            Devam ederek{' '}
            <a
              className="text-info underline-offset-2 hover:underline"
              href="/legal/terms"
              target="_blank"
              rel="noreferrer noopener"
            >
              Kullanım Koşulları
            </a>{' '}
            ve{' '}
            <a
              className="text-info underline-offset-2 hover:underline"
              href="/legal/privacy"
              target="_blank"
              rel="noreferrer noopener"
            >
              Gizlilik Politikası
            </a>
            ’nı kabul etmiş sayılırsın.
          </p>
        </div>
      </section>
    </div>
  );
}

interface SentPanelProps {
  result: SendResult;
  onResend: () => void;
  resending: boolean;
}

function SentPanel({ result, onResend, resending }: SentPanelProps) {
  return (
    <div className="flex flex-col gap-4 bg-surface-raised border border-border rounded-md p-5 shadow-card-sm">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="w-9 h-9 rounded-md bg-accent-tint text-accent flex items-center justify-center"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            role="img"
            aria-label="Gönderildi"
          >
            <path
              d="M2 4l7 5 7-5M2 4v10h14V4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-h3 text-ink">E-posta gönderildi</span>
          <span className="text-body-sm text-ink-muted">
            <span className="font-medium text-ink break-all">{result.email}</span> adresine giriş
            bağlantısı yolladık. Mail kutuna bak.
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-body-sm">
        <span className="text-ink-subtle">Maili görmedin mi?</span>
        <button
          type="button"
          onClick={onResend}
          disabled={resending}
          className="text-accent hover:text-accent-hover font-medium disabled:opacity-50"
        >
          {resending ? 'Gönderiliyor…' : 'Tekrar gönder'}
        </button>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-labelledby="google-glyph-title"
    >
      <title id="google-glyph-title">Google</title>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC04"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.32z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
