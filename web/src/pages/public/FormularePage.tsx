import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/ui';
import { t } from '../../i18n';

/**
 * UX 27.11 (#172): место для будущего помощника по формулярам. Пока только пометка «скоро»:
 * чат-бот, API, поля ввода и загрузка — после защиты.
 */
export function FormularePage() {
  return (
    <>
      <PageHeader title={t('Формуляры')} />
      <div className="card card--teal stack" data-testid="formulare-soon">
        <span className="chip" style={{ alignSelf: 'flex-start' }}>
          {t('скоро')}
        </span>
        <p style={{ margin: 0 }}>{t('Скоро здесь появится помощник по заполнению формуляров.')}</p>
      </div>
      <Link to="/" className="link row" style={{ gap: 6 }}>
        <Icon name="arrowLeft" size={18} /> {t('Главная страница')}
      </Link>
    </>
  );
}
