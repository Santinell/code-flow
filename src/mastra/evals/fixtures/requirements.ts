/**
 * Fixture requirements for architect agent evals.
 *
 * Categories:
 *  - complete:  full requirements with clear scope → needsClarification: false, minTasks ≥ 1
 *  - incomplete:  vague/ambiguous requests → needsClarification: true
 *  - ambitious:  large scope requiring decomposition into 5+ tasks
 *  - invalid:     nonsense or unactionable requests → needsClarification: true, tasks: []
 */

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

export const architectRequirements: ArchitectRequirementFixture[] = [
  // ── Complete requirements ──
  {
    id: 'dark-theme',
    category: 'complete',
    userMessage:
      'Добавить тёмную тему в приложение. Кнопка переключения должна быть в существующем компоненте Header (src/components/Header.tsx), цвета уже заданы через CSS-переменные в src/styles/theme.css. Нужно сохранять выбор темы в localStorage.',
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
    userMessage:
      'Добавить пагинацию на страницу списка пользователей (src/pages/UsersList.tsx). API-роут src/routes/users.ts уже возвращает page, totalPages, items. Нужно отображать кнопки «Назад»/«Вперёд» и номера страниц над списком.',
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
    userMessage:
      'Настроить отправку email-уведомлений при смене статуса задачи. Задачи обновляются через src/services/tasks.ts (updateTaskStatus — уже возвращает task и previousStatus), для отправки писем использовать существующий src/services/smtp.ts (sendEmail). Письмо должно содержать заголовок задачи, старый и новый статус, ссылку на задачу.',
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
    userMessage:
      'Реализовать полную систему аутентификации на базе Express-приложения из src/server.ts. Сейчас src/auth/session.ts — это заглушка (getSession/requireAuth без верификации токена, без выдачи токенов, без хранения паролей). Нужно: регистрация, вход, восстановление пароля, OAuth через Google и GitHub, роли (admin/user, уже есть тип Role), JWT-токены с refresh, middleware для проверки прав (расширить requireAuth).',
    groundTruth: {
      needsClarification: false,
      minTasks: 5,
      maxTasks: 10,
      requiredKeywords: ['аутентифик', 'регистрац', 'oauth', 'jwt', 'refresh', 'рол', 'middleware'],
    },
  },
  {
    id: 'dashboard-analytics',
    category: 'ambitious',
    userMessage:
      'Наполнить страницу дашборда (src/pages/Dashboard.tsx, сейчас это пустой каркас) аналитикой: графики посещаемости, воронка конверсии, retention-отчёт, экспорт в CSV, фильтры по дате и источнику трафика, real-time обновление через WebSocket.',
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
