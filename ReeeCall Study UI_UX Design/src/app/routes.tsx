import { createBrowserRouter } from 'react-router';
import { Landing } from './pages/Landing';
import { Content } from './pages/Content';
import { ContentDetail } from './pages/ContentDetail';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { DeckList } from './pages/DeckList';
import { DeckDetail } from './pages/DeckDetail';
import { StudySession } from './pages/StudySession';
import { Templates } from './pages/Templates';
import { TemplateEdit } from './pages/TemplateEdit';
import { Settings } from './pages/Settings';
import { Layout } from './components/Layout';
import { AuthGuard } from './components/AuthGuard';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Landing />,
  },
  {
    path: '/content',
    element: <Content />,
  },
  {
    path: '/content/:id',
    element: <ContentDetail />,
  },
  {
    path: '/auth/login',
    element: <Login />,
  },
  {
    path: '/study/:deckId',
    element: (
      <AuthGuard>
        <StudySession />
      </AuthGuard>
    ),
  },
  {
    element: (
      <AuthGuard>
        <Layout />
      </AuthGuard>
    ),
    children: [
      {
        path: '/dashboard',
        element: <Dashboard />,
      },
      {
        path: '/decks',
        element: <DeckList />,
      },
      {
        path: '/decks/:id',
        element: <DeckDetail />,
      },
      {
        path: '/templates',
        element: <Templates />,
      },
      {
        path: '/templates/:id/edit',
        element: <TemplateEdit />,
      },
      {
        path: '/settings',
        element: <Settings />,
      },
    ],
  },
]);