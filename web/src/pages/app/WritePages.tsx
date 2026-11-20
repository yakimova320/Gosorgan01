import { zodResolver } from '@hookform/resolvers/zod';
import { formatIban, OutgoingSchema, type OutgoingInput, type OutgoingTemplate } from '@jasno/shared';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { errorCode } from '../../api/errors';
import { FormError, SelectField, SubmitButton, TextAreaField, TextField } from '../../components/form';
import { Icon } from '../../components/Icon';
import { ErrorAlert, Loading, PageHeader } from '../../components/ui';
import { applyServerError } from '../../forms/serverErrors';
import { formatDate } from '../../lib/dates';
import { useCabinetQuery, useCreateOutgoingMutation, useTemplatesQuery } from '../../store/api';
import { DraftError } from './AnswerPages';

/*
 * B16: своё письмо по шаблону (макет, экраны 22–25): каталог → адресат → детали → проверка.
 * Шаг живёт в URL (?step=), значения формы — в одной форме экрана: при переходе между шагами не теряются.
 * После «Всё верно» сервер создаёт дело OUTGOING и проверенный черновик; дальше обычный экран черновика.
 * Ja!sno сам ничего не отправляет.
 */

type Step = 'recipient' | 'details' | 'check';
const STEPS: Step[] = ['recipient', 'details', 'check'];
const STEP_TITLE: Record<Step, string> = {
  recipient: 'Кому пишете',
  details: 'Что написать',
  check: 'Проверьте данные',
};

/** Экран 22: каталог шаблонов. */
export function WritePage() {
  const t = useTemplatesQuery();
  return (
    <>
      <PageHeader title="Написать письмо" subtitle="Письмо в ведомство по готовому шаблону: Ja!sno соберёт текст на немецком и перевод." />
      {t.isLoading && <Loading text="Загружаем шаблоны…" />}
      <ErrorAlert error={t.error} />
      <ul className="list-reset grid-2" aria-label="Шаблоны писем">
        {(t.data ?? []).map((tpl) => (
          <li key={tpl.id}>
            <Link to={`/app/write/${tpl.id}`} className="card stack-s" data-testid="template-card" style={{ height: '100%' }}>
              <Icon name="doc" color="var(--c-teal)" />
              <span style={{ fontWeight: 600 }}>{tpl.titleRu}</span>
              <span className="muted small">
                {tpl.titleDe} · {tpl.descriptionRu}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Письмо в ответ на полученное письмо удобнее готовить из дела: там Ja!sno возьмёт номер дела и даты из самого письма.
      </p>
    </>
  );
}

function shown(tpl: OutgoingTemplate, key: string, value: string): string {
  const f = tpl.fields.find((x) => x.key === key);
  if (!f) return value;
  if (f.type === 'date') return formatDate(value);
  if (f.type === 'select') return f.options?.find((o) => o.id === value)?.ru ?? value;
  if (f.type === 'iban') return formatIban(value);
  return value;
}

/** Экраны 23–25: адресат, детали, проверка одного шаблона. */
export function WriteTemplatePage({ templateId }: { templateId: string }) {
  const t = useTemplatesQuery();
  if (t.isLoading) return <Loading text="Загружаем шаблон…" />;
  const tpl = t.data?.find((x) => x.id === templateId);
  if (!tpl)
    return (
      <>
        <PageHeader title="Шаблон не найден" back="/app/write" />
        <ErrorAlert error={t.error} />
      </>
    );
  return <WriteForm key={tpl.id} tpl={tpl} />;
}

function WriteForm({ tpl }: { tpl: OutgoingTemplate }) {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const cabinet = useCabinetQuery();
  const [createOutgoing, creating] = useCreateOutgoingMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const step: Step = STEPS.includes(search.get('step') as Step) ? (search.get('step') as Step) : 'recipient';
  const form = useForm<OutgoingInput>({
    resolver: zodResolver(OutgoingSchema),
    mode: 'onTouched',
    defaultValues: {
      templateId: tpl.id,
      recipient: { name: '', address: '' },
      fields: Object.fromEntries(tpl.fields.map((f) => [f.key, ''])),
    },
  });
  const { register, formState, trigger, getValues, watch } = form;
  const errors = formState.errors;
  const sending = useRef(false);

  const recipientFields = ['recipient.name', 'recipient.address'] as const;
  const detailFields = tpl.fields.map((f) => `fields.${f.key}` as const);
  const go = (s: Step) => navigate(`/app/write/${tpl.id}?step=${s}`);

  async function next(fields: readonly string[], to: Step) {
    setFormError(null);
    // пути полей шаблона известны только во время работы
    if (await trigger(fields as Parameters<typeof trigger>[0], { shouldFocus: true })) await go(to);
  }

  async function submit() {
    if (sending.current) return; // повторное нажатие во время запроса
    sending.current = true;
    setFormError(null);
    setError(null);
    try {
      const values = getValues();
      const { caseId, draft } = await createOutgoing(values).unwrap();
      navigate(`/app/cases/${caseId}/answer/draft?draft=${draft.id}&kind=TEMPLATE`, { replace: true });
    } catch (err) {
      const known = [...recipientFields, ...detailFields];
      const message = applyServerError(err, form.setError, known);
      const fieldErrors = Object.keys((err as { details?: { fields?: object } })?.details?.fields ?? {});
      if (fieldErrors.some((k) => k.startsWith('recipient.'))) await go('recipient');
      else if (fieldErrors.length) await go('details');
      if (errorCode(err) === 'DRAFT_VERIFICATION_FAILED' || errorCode(err) === 'PROFILE_INCOMPLETE') setError(err);
      else setFormError(message);
    } finally {
      sending.current = false;
    }
  }

  const values = watch();
  // Обновили страницу на шаге проверки: значений нет, начинаем с адресата.
  if (step === 'check' && !OutgoingSchema.safeParse(values).success)
    return <Navigate to={`/app/write/${tpl.id}?step=recipient`} replace />;

  const stepIndex = STEPS.indexOf(step);
  const back = stepIndex === 0 ? '/app/write' : `/app/write/${tpl.id}?step=${STEPS[stepIndex - 1]}`;
  const profile = cabinet.data?.profile;

  return (
    <>
      <PageHeader title={`${tpl.titleRu}: ${STEP_TITLE[step].toLowerCase()}`} subtitle={`${tpl.titleDe} · шаг ${stepIndex + 1} из 3`} back={back} />

      {step === 'recipient' && (
        <form className="card stack" noValidate onSubmit={(e) => { e.preventDefault(); void next(recipientFields, 'details'); }}>
          <TextField
            id="w-recipient-name"
            label="Ведомство или организация"
            hint="Как в его письмах, латиницей. Например: Jobcenter Berlin Mitte"
            registration={register('recipient.name')}
            error={errors.recipient?.name}
          />
          <TextAreaField
            id="w-recipient-address"
            label="Адрес"
            hint="Улица или Postfach, индекс и город — с конверта или из письма ведомства"
            registration={register('recipient.address')}
            error={errors.recipient?.address}
          />
          <button type="submit" className="btn btn--primary">
            Дальше
          </button>
        </form>
      )}

      {step === 'details' && (
        <form className="card stack" noValidate onSubmit={(e) => { e.preventDefault(); void next(detailFields, 'check'); }}>
          {tpl.noteRu && <div className="alert alert--info">{tpl.noteRu}</div>}
          {tpl.fields.map((f) => {
            const id = `w-${f.key}`;
            const label = f.required ? f.labelRu : `${f.labelRu} (необязательно)`;
            const registration = register(`fields.${f.key}`);
            const error = errors.fields?.[f.key];
            if (f.type === 'select')
              return <SelectField key={f.key} id={id} label={label} hint={f.hintRu} options={f.options ?? []} registration={registration} error={error} />;
            return (
              <TextField
                key={f.key}
                id={id}
                label={label}
                hint={f.hintRu}
                type={f.type === 'date' ? 'date' : 'text'}
                autoCapitalize={f.type === 'iban' ? 'characters' : undefined}
                autoComplete="off"
                registration={registration}
                error={error}
              />
            );
          })}
          {tpl.id === 'AENDERUNG' && values.fields.change === 'ADDRESS' && (
            <div className="alert alert--info" role="status">
              Новый адрес возьмётся из профиля: {profile?.address ?? '…'}. Если там ещё старый, сначала <Link to="/app/profile">измените профиль</Link>.
            </div>
          )}
          <button type="submit" className="btn btn--primary">
            Дальше
          </button>
        </form>
      )}

      {step === 'check' && (
        <>
          <section className="card stack-s" aria-label="Данные письма" data-testid="write-check">
            <span className="eyebrow">Отправитель (из профиля)</span>
            <span>
              {profile ? `${profile.firstName} ${profile.lastName}, ${profile.address}` : '…'}
            </span>
            <span className="eyebrow">Кому</span>
            <span style={{ whiteSpace: 'pre-wrap' }}>
              {values.recipient.name}
              {'\n'}
              {values.recipient.address}
            </span>
            <span className="eyebrow">Что войдёт в письмо</span>
            <dl className="stack-s" style={{ margin: 0 }}>
              {tpl.fields
                .filter((f) => values.fields[f.key]?.trim())
                .map((f) => (
                  <div key={f.key}>
                    <dt className="muted small">{f.labelRu}</dt>
                    <dd style={{ margin: 0, fontWeight: 600 }}>{shown(tpl, f.key, values.fields[f.key].trim())}</dd>
                  </div>
                ))}
            </dl>
            <Link to={`/app/write/${tpl.id}?step=details`} className="link small">
              Изменить
            </Link>
          </section>
          <div className="alert alert--info">
            Нажимая «Всё верно», вы подтверждаете эти данные. Ja!sno соберёт письмо только из них и профиля, без догадок, и
            заведёт для него дело. Отправляете вы сами.
          </div>
          <FormError message={formError} />
          {error ? <DraftError error={error} caseId="" /> : null}
          <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <SubmitButton submitting={creating.isLoading} busyText="Собираем письмо…">
              Всё верно, собрать письмо
            </SubmitButton>
          </form>
        </>
      )}
    </>
  );
}
