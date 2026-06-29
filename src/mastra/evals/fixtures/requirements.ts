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
      'Добавить тёмную тему в приложение. Нужна кнопка переключения в header, сохранение выбора в localStorage, поддержка CSS-переменных для цветов.',
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
      'Добавить пагинацию на страницу списка пользователей. API уже возвращает page, totalPages, items. Фронтенд должен отображать кнопки «Назад»/«Вперёд» и номера страниц.',
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
      'Настроить отправку email-уведомлений при смене статуса задачи. Использовать существующий SMTP-сервис. Письмо должно содержать заголовок задачи, старый и новый статус, ссылку на задачу.',
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
      'Реализовать полную систему аутентификации: регистрация, вход, восстановление пароля, OAuth через Google и GitHub, роли (admin/user), JWT-токены с refresh, middleware для проверки прав.',
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
      'Создать дашборд аналитики: графики посещаемости, воронка конверсии, retention-отчёт, экспорт в CSV, фильтры по дате и источнику трафика, real-time обновление через WebSocket.',
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
