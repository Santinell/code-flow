/**
 * Fixture requirements for architect agent evals.
 *
 * Categories:
 *  - complete:  full requirements with clear scope → needsClarification: false, minTasks ≥ 1
 *  - incomplete:  vague/ambiguous requests → needsClarification: true
 *  - ambitious:  large scope requiring decomposition into 5+ tasks
 *  - invalid:     nonsense or unactionable requests → needsClarification: true, tasks: []
 *
 * Параметризовано по языку: один и тот же сценарий декомпозиции, но ссылки на файлы
 * указывают на структуру соответствующей фикстуры (TS-компоненты для node,
 * Flask-модули для python). requiredKeywords намеренно совпадают между языками —
 * scorer'ы языково-нейтральны и проверяют семантику требований, а не расширения.
 */

export type RequirementLanguage = 'node' | 'python';

export interface ArchitectRequirementFixture {
  id: string;
  category: 'complete' | 'incomplete' | 'ambitious' | 'invalid';
  userMessage: string;
  groundTruth: {
    needsClarification: boolean;
    minTasks: number;
    maxTasks?: number;
    requiredKeywords: string[];
    forbiddenKeywords?: string[];
  };
}

interface NodeRefs {
  header: string;
  theme: string;
  usersList: string;
  usersRoute: string;
  appEntry: string;
  session: string;
  tasksService: string;
  smtpService: string;
  dashboard: string;
}

const NODE_REFS: NodeRefs = {
  header: 'src/components/Header.tsx',
  theme: 'src/styles/theme.css',
  usersList: 'src/pages/UsersList.tsx',
  usersRoute: 'src/routes/users.ts',
  appEntry: 'src/server.ts',
  session: 'src/auth/session.ts',
  tasksService: 'src/services/tasks.ts',
  smtpService: 'src/services/smtp.ts',
  dashboard: 'src/pages/Dashboard.tsx',
};

const PYTHON_REFS: NodeRefs = {
  header: 'src/components/header.py',
  theme: 'src/static/styles.css',
  usersList: 'src/pages/users_list.py',
  usersRoute: 'src/routes/users.py',
  appEntry: 'src/app.py',
  session: 'src/auth/session.py',
  tasksService: 'src/services/tasks.py',
  smtpService: 'src/services/smtp.py',
  dashboard: 'src/pages/dashboard.py',
};

function buildRequirements(refs: NodeRefs): ArchitectRequirementFixture[] {
  return [
    // ── Complete requirements ──
    {
      id: 'dark-theme',
      category: 'complete',
      userMessage: `Добавить тёмную тему в приложение. Кнопка переключения должна быть в существующем компоненте (${refs.header}), цвета уже заданы через CSS-переменные в ${refs.theme}. Нужно сохранять выбор темы в localStorage.`,
      groundTruth: {
        needsClarification: false,
        minTasks: 2,
        maxTasks: 5,
        requiredKeywords: ['тёмн', 'theme', 'dark', 'css', 'localStorage', 'переключ'],
      },
    },
    {
      id: 'pagination',
      category: 'complete',
      userMessage: `Добавить пагинацию на страницу списка пользователей (${refs.usersList}). API-роут ${refs.usersRoute} уже возвращает page, totalPages, items. Нужно отображать кнопки «Назад»/«Вперёд» и номера страниц над списком.`,
      groundTruth: {
        needsClarification: false,
        minTasks: 1,
        maxTasks: 3,
        requiredKeywords: ['paginat', 'page', 'страниц', 'назад', 'вперёд'],
      },
    },
    {
      id: 'email-notifications',
      category: 'complete',
      userMessage: `Настроить отправку email-уведомлений при смене статуса задачи. Задачи обновляются через ${refs.tasksService} (update_task_status — уже возвращает task и previous_status), для отправки писем использовать существующий ${refs.smtpService} (send_email). Письмо должно содержать заголовок задачи, старый и новый статус, ссылку на задачу.`,
      groundTruth: {
        needsClarification: false,
        minTasks: 1,
        maxTasks: 4,
        requiredKeywords: ['email', 'уведомл', 'smtp', 'статус', 'задач'],
      },
    },

    // ── Incomplete requirements ──
    {
      id: 'vague-improve',
      category: 'incomplete',
      userMessage: 'Сделать что-то с производительностью',
      groundTruth: {
        needsClarification: true,
        minTasks: 0,
        maxTasks: 0,
        requiredKeywords: [],
      },
    },
    {
      id: 'underspecified-feature',
      category: 'incomplete',
      userMessage: 'Добавить интеграцию с внешним сервисом',
      groundTruth: {
        needsClarification: true,
        minTasks: 0,
        maxTasks: 0,
        requiredKeywords: [],
      },
    },

    // ── Ambitious requirements ──
    {
      id: 'full-auth-system',
      category: 'ambitious',
      userMessage: `Реализовать полную систему аутентификации на базе Flask-приложения из ${refs.appEntry}. Сейчас ${refs.session} — это заглушка (get_session/require_auth без верификации токена, без выдачи токенов, без хранения паролей). Нужно: регистрация, вход, восстановление пароля, OAuth через Google и GitHub, роли (admin/user, уже есть тип Role), JWT-токены с refresh, middleware для проверки прав (расширить require_auth).`,
      groundTruth: {
        needsClarification: false,
        minTasks: 5,
        maxTasks: 10,
        requiredKeywords: [
          'аутентифик',
          'регистрац',
          'oauth',
          'jwt',
          'refresh',
          'рол',
          'middleware',
        ],
      },
    },
    {
      id: 'dashboard-analytics',
      category: 'ambitious',
      userMessage: `Наполнить страницу дашборда (${refs.dashboard}, сейчас это пустой каркас) аналитикой: графики посещаемости, воронка конверсии, retention-отчёт, экспорт в CSV, фильтры по дате и источнику трафика, real-time обновление через WebSocket.`,
      groundTruth: {
        needsClarification: false,
        minTasks: 5,
        maxTasks: 10,
        requiredKeywords: ['дашборд', 'аналитик', 'график', 'csv', 'websocket', 'фильтр'],
      },
    },

    // ── Invalid requests ──
    {
      id: 'nonsense-input',
      category: 'invalid',
      userMessage: 'asdfghjkl',
      groundTruth: {
        needsClarification: true,
        minTasks: 0,
        maxTasks: 0,
        requiredKeywords: [],
      },
    },
    {
      id: 'empty-input',
      category: 'invalid',
      userMessage: ' ',
      groundTruth: {
        needsClarification: true,
        minTasks: 0,
        maxTasks: 0,
        requiredKeywords: [],
      },
    },
  ];
}

export const architectNodejsRequirements: ArchitectRequirementFixture[] =
  buildRequirements(NODE_REFS);

export const architectPythonRequirements: ArchitectRequirementFixture[] =
  buildRequirements(PYTHON_REFS);
