import type { ReactNode } from 'react';
import { AppShell, ModeBadge, PublicLayout } from '../components/layout';
import { AnswerDetailsPage, AnswerDraftPage, AnswerGoalPage, AnswerSendPage, DonePage } from '../pages/app/AnswerPages';
import { CabinetPage, CasePage, CasesPage, HistoryPage, LetterPage } from '../pages/app/CabinetPages';
import { AskPage, ProfilePage, WritePage } from '../pages/app/MorePages';
import { ScanAssignPage, ScanFactsPage, ScanPagesPage, ScanReadingPage, ScanStartPage } from '../pages/app/ScanPages';
import { ForgotPage, LoginPage, RegisterPage, ResetPage } from '../pages/public/AuthPages';
import { BeratungPage, FaqPage, NotFoundPage, WissenPage } from '../pages/public/InfoPages';
import { StartPage } from '../pages/public/StartPage';
import { FlowProvider } from './flow';
import { matchPath, Redirect, RouterProvider, useRouter, type Params } from './router';
import { SessionProvider, useSession } from './session';

interface Route {
  path: string;
  /** cabinet: нужен вход, экран внутри кабинета */
  area: 'public' | 'cabinet';
  render: (params: Params, search: URLSearchParams) => ReactNode;
}

/*
 * Все экраны сайта. Карта экранов: ТЗ v3 раздел 5 и ТЗ v4 раздел 13.
 * Готовность каждого экрана: docs/readiness.md.
 */
export const ROUTES: Route[] = [
  { path: '/', area: 'public', render: () => <StartPage /> },
  { path: '/login', area: 'public', render: () => <LoginPage /> },
  { path: '/register', area: 'public', render: () => <RegisterPage /> },
  { path: '/forgot', area: 'public', render: () => <ForgotPage /> },
  { path: '/reset', area: 'public', render: () => <ResetPage /> },
  { path: '/faq', area: 'public', render: () => <FaqPage /> },
  { path: '/wissen', area: 'public', render: () => <WissenPage /> },
  { path: '/beratung', area: 'public', render: () => <BeratungPage /> },

  { path: '/app', area: 'cabinet', render: () => <CabinetPage /> },
  { path: '/app/cases', area: 'cabinet', render: () => <CasesPage /> },
  { path: '/app/cases/:id', area: 'cabinet', render: (p) => <CasePage id={p.id} /> },
  { path: '/app/cases/:id/answer', area: 'cabinet', render: (p) => <AnswerGoalPage caseId={p.id} /> },
  { path: '/app/cases/:id/answer/details', area: 'cabinet', render: (p) => <AnswerDetailsPage caseId={p.id} /> },
  { path: '/app/cases/:id/answer/draft', area: 'cabinet', render: (p) => <AnswerDraftPage caseId={p.id} /> },
  { path: '/app/cases/:id/answer/send', area: 'cabinet', render: (p) => <AnswerSendPage caseId={p.id} /> },
  { path: '/app/letters/:id', area: 'cabinet', render: (p, s) => <LetterPage id={p.id} caseId={s.get('case')} /> },
  { path: '/app/scan', area: 'cabinet', render: () => <ScanStartPage /> },
  { path: '/app/scan/pages', area: 'cabinet', render: () => <ScanPagesPage /> },
  { path: '/app/scan/reading', area: 'cabinet', render: () => <ScanReadingPage /> },
  { path: '/app/scan/facts', area: 'cabinet', render: () => <ScanFactsPage /> },
  { path: '/app/scan/assign', area: 'cabinet', render: () => <ScanAssignPage /> },
  { path: '/app/history', area: 'cabinet', render: () => <HistoryPage /> },
  { path: '/app/ask', area: 'cabinet', render: () => <AskPage /> },
  { path: '/app/write', area: 'cabinet', render: () => <WritePage /> },
  { path: '/app/profile', area: 'cabinet', render: () => <ProfilePage /> },
  { path: '/app/done', area: 'cabinet', render: () => <DonePage /> },
];

function Screen() {
  const { path, search } = useRouter();
  const { token } = useSession();

  for (const route of ROUTES) {
    const params = matchPath(route.path, path);
    if (!params) continue;
    if (route.area === 'cabinet') {
      if (!token) return <Redirect to="/login" />;
      return <AppShell key={route.path}>{route.render(params, search)}</AppShell>;
    }
    return <PublicLayout key={route.path}>{route.render(params, search)}</PublicLayout>;
  }
  return (
    <PublicLayout>
      <NotFoundPage />
    </PublicLayout>
  );
}

export function App({ initialPath, initialToken }: { initialPath?: string; initialToken?: string | null }) {
  return (
    <SessionProvider initialToken={initialToken}>
      <RouterProvider initialPath={initialPath}>
        <FlowProvider>
          <ModeBadge />
          <Screen />
        </FlowProvider>
      </RouterProvider>
    </SessionProvider>
  );
}
