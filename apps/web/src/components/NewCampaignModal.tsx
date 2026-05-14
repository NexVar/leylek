import type { FormEvent } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '../api/client';
import { useCreateCampaign } from '../api/hooks';
import type { CampaignMode } from '../api/types';
import { Button } from './Button';
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

/**
 * "Yeni kampanya" modal. Submits to POST /api/campaigns which runs the
 * content-agent → D1 → publisher-agent chain server-side. We show a
 * "İçerik ajanı çalışıyor…" loading state because the call takes ~15s.
 */
export function NewCampaignModal({ open, onClose }: NewCampaignModalProps) {
  const navigate = useNavigate();
  const createMutation = useCreateCampaign();

  const [productUrl, setProductUrl] = useState('');
  const [budget, setBudget] = useState('1000');
  const [mode, setMode] = useState<CampaignMode>('OTOPILOT');
  const [errors, setErrors] = useState<FieldErrors>({});

  const handleClose = () => {
    if (createMutation.isPending) return;
    setProductUrl('');
    setBudget('1000');
    setMode('OTOPILOT');
    setErrors({});
    createMutation.reset();
    onClose();
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

    try {
      const { campaign } = await createMutation.mutateAsync({
        productUrl: parsed.data.productUrl,
        mode,
        dailyBudgetKurus: Math.round(parsed.data.dailyBudgetTry * 100),
      });
      handleClose();
      navigate(`/campaigns/${campaign.id}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Kampanya oluşturulamadı. Tekrar dene.';
      setErrors({ _form: msg });
    }
  };

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
