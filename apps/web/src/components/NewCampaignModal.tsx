import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '../api/client';
import type { CampaignAudience, CreateCampaignResponse } from '../api/hooks';
import { useCreateCampaign } from '../api/hooks';
import type { CampaignMode } from '../api/types';
import { Button } from './Button';
import { CampaignCreationProgress, type CreationStage } from './CampaignCreationProgress';
import { Input } from './Input';
import { Modal } from './Modal';
import { Pill } from './Pill';
import { SegmentedToggle } from './SegmentedToggle';

interface NewCampaignModalProps {
  open: boolean;
  onClose: () => void;
}

const FormSchema = z.object({
  productUrl: z
    .string()
    .min(1, 'Ürün URL’si gerekli.')
    .url('Geçerli bir URL gir (https://… ile başlamalı).'),
  dailyBudgetTry: z
    .number({ invalid_type_error: 'Bütçe sayı olmalı.' })
    .positive('Bütçe sıfırdan büyük olmalı.')
    .max(1_000_000, 'Bütçe çok yüksek (max 1.000.000 TL).'),
});

type FieldErrors = Partial<Record<'productUrl' | 'dailyBudgetTry' | '_form', string>>;

// Artificial stage durations (ms) — keep the reveal feeling deliberate even
// when the API resolves fast. The publish step never advances on the timer;
// it waits for the mutation to actually finish so the reveal isn't lying.
const STAGE_DURATIONS: Partial<Record<CreationStage, number>> = {
  scrape: 1700,
  audience: 2400,
  strategy: 2400,
  images: 2600,
};

/**
 * "Yeni kampanya" modal. POSTs to `/api/campaigns` which runs the full
 * content-agent → D1 → publisher-agent chain server-side (~15-20s). While
 * that's in flight the modal flips into a 6-stage `CampaignCreationProgress`
 * reveal — `scrape → audience → strategy → images → publish → done` — so
 * the user (and jury, in demo) sees the AI work happen step by step. The
 * first four stages advance on a fixed timer; `publish` blocks on the API
 * actually returning; `done` shows the final result + CTA to the detail page.
 */
export function NewCampaignModal({ open, onClose }: NewCampaignModalProps) {
  const navigate = useNavigate();
  const createMutation = useCreateCampaign();

  const [productUrl, setProductUrl] = useState('');
  const [budget, setBudget] = useState('1000');
  const [mode, setMode] = useState<CampaignMode>('OTOPILOT');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [stage, setStage] = useState<CreationStage | null>(null);
  const [result, setResult] = useState<CreateCampaignResponse | null>(null);
  const timeoutsRef = useRef<number[]>([]);

  const clearTimers = () => {
    for (const id of timeoutsRef.current) window.clearTimeout(id);
    timeoutsRef.current = [];
  };

  // Stash the result as soon as the mutation resolves — independent of which
  // artificial stage we're on, so the data is ready when `publish` reveals.
  useEffect(() => {
    if (createMutation.isSuccess && createMutation.data) {
      setResult(createMutation.data);
    }
  }, [createMutation.isSuccess, createMutation.data]);

  // Advance `publish` → `done` only when we've actually reached `publish` AND
  // the mutation has resolved. The old version watched only `isSuccess`, so a
  // fast API would set `done` early — then the still-pending artificial
  // timers (`strategy`, `images`, `publish`) would fire after and bounce the
  // stage back to `publish`, leaving the modal stuck on the last step.
  useEffect(() => {
    if (stage !== 'publish' || !createMutation.isSuccess) return;
    const id = window.setTimeout(() => setStage('done'), 800);
    timeoutsRef.current.push(id);
    return () => window.clearTimeout(id);
  }, [stage, createMutation.isSuccess]);

  // Clean up timers on unmount. Inlined (not via `clearTimers`) so biome's
  // exhaustive-deps rule doesn't drag a new dep into a mount-only effect.
  useEffect(() => {
    const timers = timeoutsRef;
    return () => {
      for (const id of timers.current) window.clearTimeout(id);
      timers.current = [];
    };
  }, []);

  const handleClose = () => {
    if (createMutation.isPending) return;
    clearTimers();
    setProductUrl('');
    setBudget('1000');
    setMode('OTOPILOT');
    setErrors({});
    setStage(null);
    setResult(null);
    createMutation.reset();
    onClose();
  };

  const handleGoToCampaign = () => {
    const id = result?.campaign?.id;
    handleClose();
    if (id) navigate(`/campaigns/${id}`);
  };

  const scheduleArtificialStages = () => {
    clearTimers();
    setStage('scrape');
    let acc = 0;
    // Schedule audience, strategy, images. `publish` is entered after `images`
    // even if the mutation is still pending — `mutationReady` controls the
    // transition out of `publish`.
    const transitions: CreationStage[] = ['audience', 'strategy', 'images', 'publish'];
    let prev: CreationStage = 'scrape';
    for (const next of transitions) {
      acc += STAGE_DURATIONS[prev] ?? 2000;
      const tid = window.setTimeout(() => setStage(next), acc);
      timeoutsRef.current.push(tid);
      prev = next;
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrors({});

    const parsed = FormSchema.safeParse({
      productUrl: productUrl.trim(),
      dailyBudgetTry: Number(budget),
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0];
        if (k === 'productUrl' || k === 'dailyBudgetTry') {
          next[k] = issue.message;
        }
      }
      setErrors(next);
      return;
    }

    scheduleArtificialStages();

    try {
      await createMutation.mutateAsync({
        productUrl: parsed.data.productUrl,
        mode,
        dailyBudgetKurus: Math.round(parsed.data.dailyBudgetTry * 100),
      });
      // success path handled by the useEffect on mutation.isSuccess
    } catch (err) {
      clearTimers();
      setStage(null);
      const msg = err instanceof ApiError ? err.message : 'Kampanya oluşturulamadı. Tekrar dene.';
      setErrors({ _form: msg });
    }
  };

  // ---- progress / done view ------------------------------------------------
  if (stage !== null) {
    const dailyBudgetTry = Number(budget) || 0;
    const audience: CampaignAudience | null = result?.audience ?? null;
    const ads = result?.ads ?? [];

    return (
      <Modal
        open={open}
        onClose={handleClose}
        locked={stage !== 'done'}
        title={stage === 'done' ? 'Kampanya yayında' : 'Kampanya kuruluyor'}
        subtitle={
          stage === 'done'
            ? 'Tüm varyantlar Google Ads + Meta sandbox’a verildi.'
            : 'Leylek ajanları çalışıyor — her adımı aşağıda görebilirsin.'
        }
        size="lg"
      >
        <CampaignCreationProgress
          productUrl={productUrl}
          dailyBudgetTry={dailyBudgetTry}
          audience={audience}
          ads={ads}
          stage={stage}
          mutationReady={createMutation.isSuccess}
        />
        {stage === 'done' ? (
          <div className="flex items-center justify-end gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Kapat
            </Button>
            <Button type="button" variant="primary" onClick={handleGoToCampaign}>
              Kampanyaya git
            </Button>
          </div>
        ) : null}
      </Modal>
    );
  }

  // ---- form view -----------------------------------------------------------
  return (
    <Modal
      open={open}
      onClose={handleClose}
      locked={createMutation.isPending}
      title="Yeni kampanya"
      subtitle="Ürün URL’ini ver — içerik ajanı varyantları üretsin, yayın ajanı sandbox’a aktarsın."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <Input
          type="url"
          inputMode="url"
          label="Ürün URL"
          placeholder="https://magaza.com/akilli-cay-demlik"
          autoComplete="url"
          value={productUrl}
          onChange={(e) => setProductUrl(e.target.value)}
          error={errors.productUrl}
          disabled={createMutation.isPending}
          required
        />

        <Input
          type="number"
          inputMode="decimal"
          min={1}
          step={1}
          label="Günlük bütçe (TRY)"
          placeholder="1000"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          error={errors.dailyBudgetTry}
          hint="Otopilotta üç varyant arasında otomatik bölüştürülür."
          disabled={createMutation.isPending}
          required
        />

        <SegmentedToggle<CampaignMode>
          label="Mod"
          value={mode}
          onChange={setMode}
          disabled={createMutation.isPending}
          options={[
            { value: 'OTOPILOT', label: 'Otopilot' },
            { value: 'COPILOT', label: 'Co-Pilot' },
          ]}
        />
        <p className="text-body-sm text-ink-subtle -mt-3">
          {mode === 'OTOPILOT'
            ? 'Ajan zarar koruması tetiklenince doğrudan eyleme geçer.'
            : 'Ajan öneri yapar, eyleme geçmeden önce onayını bekler.'}
        </p>

        <div className="rounded-md bg-surface-sunken/60 border border-border px-4 py-3 text-body-sm text-ink-muted">
          İçerik ajanı 3 varyant üretecek, ardından yayın ajanı sim sandbox’a aktaracak. ~15 saniye.
        </div>

        {errors._form ? (
          <Pill tone="danger" dot>
            {errors._form}
          </Pill>
        ) : null}

        <div className="flex items-center justify-end gap-3 pt-1">
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={createMutation.isPending}
          >
            Vazgeç
          </Button>
          <Button type="submit" variant="primary" loading={createMutation.isPending}>
            {createMutation.isPending ? 'İçerik ajanı çalışıyor…' : 'Yayına başla'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
