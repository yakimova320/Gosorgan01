import { useMemo, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import {
  createBrowserRouter,
  createHashRouter,
  createMemoryRouter,
  Navigate,
  Outlet,
  useParams,
  useSearchParams,
  type RouteObject,
} from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppShell, MockBanner, ModeBadge, PublicLayout } from '../components/layout';
import {
  AnswerDetailsPage,
  AnswerDraftPage,
  AnswerGoalPage,
  AnswerSendPage,
  DonePage,
} from '../pages/app/AnswerPages';
import { CabinetPage, CasesPage } from '../pages/app/CabinetPages';
import { CasePage, HistoryPage, LetterPage } from '../pages/app/CasePages';
import { AskPage, ProfilePage } from '../pages/app/MorePages';
import { WritePage, WriteTemplatePage } from '../pages/app/WritePages';
import {
  LetterCheckPage,
  ScanPagesPage,
  ScanReadingPage,
  ScanStartPage,
} from '../pages/app/ScanPages';
import {
  ForgotPage,
  LoginPage,
  RegisterPage,
  ResetPage,
} from '../pages/public/AuthPages';
import {
  BeratungPage,
  FaqPage,
  NotFoundPage,
  WissenPage,
} from '../pages/public/InfoPages';
import { StartPage } from '../pages/public/StartPage';
import { FlowProvider } from './flow';
import { createStore, useSession } from '../store';
import { readStoredToken } from '../store/session';

type Params = Record<string, string>;

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
  {
    path: '/app/cases/:id',
    area: 'cabinet',
    render: (p) => <CasePage key={p.id} id={p.id} />,
  },
  {
    path: '/app/cases/:id/answer',
    area: 'cabinet',
    render: (p) => <AnswerGoalPage caseId={p.id} />,
  },
  {
    path: '/app/cases/:id/answer/details',
    area: 'cabinet',
    render: (p) => <AnswerDetailsPage caseId={p.id} />,
  },
  {
    path: '/app/cases/:id/answer/draft',
    area: 'cabinet',
    render: (p) => <AnswerDraftPage caseId={p.id} />,
  },
  {
    path: '/app/cases/:id/answer/send',
    area: 'cabinet',
    render: (p) => <AnswerSendPage caseId={p.id} />,
  },
  {
    path: '/app/letters/:id/check',
    area: 'cabinet',
    render: (p) => <LetterCheckPage key={p.id} id={p.id} />,
  },
  {
    path: '/app/letters/:id',
    area: 'cabinet',
    render: (p) => <LetterPage key={p.id} id={p.id} />,
  },
  { path: '/app/scan', area: 'cabinet', render: () => <ScanStartPage /> },
  { path: '/app/scan/pages', area: 'cabinet', render: () => <ScanPagesPage /> },
  {
    path: '/app/scan/reading',
    area: 'cabinet',
    render: () => <ScanReadingPage />,
  },
  { path: '/app/history', area: 'cabinet', render: () => <HistoryPage /> },
  { path: '/app/ask', area: 'cabinet', render: () => <AskPage /> },
  { path: '/app/write', area: 'cabinet', render: () => <WritePage /> },
  {
    path: '/app/write/:id',
    area: 'cabinet',
    render: (p) => <WriteTemplatePage key={p.id} templateId={p.id} />,
  },
  { path: '/app/profile', area: 'cabinet', render: () => <ProfilePage /> },
  { path: '/app/done', area: 'cabinet', render: () => <DonePage /> },
];

/** Адрес после «#»: сайт открыт как файл (офлайн-показ) или демо-сборка с window.__JASNO_HASH__ = true. */
const HASH_MODE =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'file:' ||
    (window as unknown as { __JASNO_HASH__?: boolean }).__JASNO_HASH__ ===
      true);

function RouteScreen({ route }: { route: Route }) {
  const params = useParams() as Params;
  const [search] = useSearchParams();
  const { token } = useSession();
  if (route.area === 'cabinet') {
    if (!token) return <Navigate to="/login" replace />;
    return <AppShell key={route.path}>{route.render(params, search)}</AppShell>;
  }
  return (
    <PublicLayout key={route.path}>{route.render(params, search)}</PublicLayout>
  );
}

/** Общая оболочка всех маршрутов: остаётся на месте при переходах, поэтому состояние сценария не теряется. */
function Root() {
  return (
    <FlowProvider>
      <ModeBadge />
      <MockBanner />
      <Outlet />
    </FlowProvider>
  );
}

const ROUTE_OBJECTS: RouteObject[] = [
  {
    element: <Root />,
    children: [
      ...ROUTES.map((route) => ({
        path: route.path,
        element: <RouteScreen route={route} />,
      })),
      {
        path: '*',
        element: (
          <PublicLayout>
            <NotFoundPage />
          </PublicLayout>
        ),
      },
    ],
  },
];

/** initialPath и initialToken нужны для тестов и офлайн-показа; без них адрес и токен берутся из браузера. */
export function App({
  initialPath,
  initialToken,
}: {
  initialPath?: string;
  initialToken?: string | null;
}) {
  const store = useMemo(
    () =>
      createStore({
        token: initialToken !== undefined ? initialToken : readStoredToken(),
        expired: false,
      }),
    [initialToken],
  );
  const router = useMemo(() => {
    if (initialPath)
      return createMemoryRouter(ROUTE_OBJECTS, {
        initialEntries: [initialPath],
      });
    return HASH_MODE
      ? createHashRouter(ROUTE_OBJECTS)
      : createBrowserRouter(ROUTE_OBJECTS);
  }, [initialPath]);
  return (
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  );
}
