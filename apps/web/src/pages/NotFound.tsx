import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';

export function NotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 bg-surface">
      <Logo size="md" />
      <div className="flex flex-col items-center gap-2 text-center max-w-md">
        <span className="font-mono text-[11px] text-ink-subtle uppercase tracking-[0.08em]">
          404
        </span>
        <h1 className="text-h1 text-ink">Bu sayfa Leylek’in haritasında yok.</h1>
        <p className="text-body-md text-ink-muted">
          Belki sildiğin veya henüz yapmadığımız bir şeye bakıyorsun. Bizi dashboard üzerinden geri
          bul.
        </p>
      </div>
      <Link to="/dashboard">
        <Button variant="primary">Dashboard’a dön</Button>
      </Link>
    </div>
  );
}
