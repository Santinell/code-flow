import type { ReviewerVerdict } from '#mastra/workflows/reviewer-workflow.types';
import {
  AUTH_BYPASS_DIFF,
  CLEAN_ERROR_HANDLING_DIFF,
  CLEAN_JSDOC_DIFF,
  CLEAN_OPTIONAL_CHAINING_DIFF,
  CLEAN_REFACTOR_DIFF,
  CLEAN_TYPE_ANNOTATION_DIFF,
  HARDCODED_SECRET_DIFF,
  NO_TESTS_DIFF,
  SQL_INJECTION_DIFF,
  XSS_VULNERABILITY_DIFF,
} from '../fixtures/code-diffs-nodejs';

export type ReviewerDatasetItem = {
  id: string;
  input: string;
  groundTruth: {
    expectedVerdict: ReviewerVerdict;
    isClean: boolean;
    expectedIssues: string[];
    changedFiles: string[];
    afterFiles: Record<string, string>;
    beforeFiles?: Record<string, string>;
  };
};

function createReviewerPrompt(params: {
  taskIdentifier: string;
  taskTitle: string;
  branchName: string;
  changedFiles: string[];
  diff: string;
}): string {
  return `Review the following code changes for task **${params.taskIdentifier}: ${params.taskTitle}**.
\nBranch: \`${params.branchName}\`
\n## Changed Files
${params.changedFiles.map((file) => `- \`${file}\``).join('\n')}
\n## Full Diff
\`\`\`diff
${params.diff}
\`\`\`
\nPerform a thorough code review.
Use the readFile tool to inspect any file in detail if you need more context.
You cannot run commands or modify anything - only read and analyze.`;
}

// ── After-file content literals (what the code should look like after the diff is applied) ──

const SQL_INJECTION_AFTER = [
  'export async function getUser(req, res) {',
  '  const { email } = req.query;',
  '  const rows = await db.query(',
  '    "SELECT * FROM users WHERE email = \'" + email + "\' LIMIT 1"',
  '  );',
  '  const user = rows[0];',
  '  res.json(user);',
  '}',
  '',
].join('\n');

const HARDCODED_SECRET_AFTER = [
  'export const paymentConfig = {',
  '  apiKey: "sk_live_51N8xHardcodedSecretValue",',
  '  webhookToleranceMs: 300000,',
  '};',
  '',
].join('\n');

const XSS_AFTER = [
  'type Props = { bio: string };',
  '',
  'export function Profile({ bio }: Props) {',
  '  return (',
  '    <section dangerouslySetInnerHTML={{ __html: bio }} />',
  '  );',
  '}',
  '',
].join('\n');

const CLEAN_REFACTOR_AFTER = [
  'export function formatDisplayName(firstName: string, lastName: string) {',
  '  return [firstName, lastName]',
  '    .map((part) => part.trim())',
  '    .filter(Boolean)',
  '    .join(" ");',
  '}',
  '',
].join('\n');

const NO_TESTS_AFTER = [
  'export function validatePassword(password: string) {',
  '  if (password.length < 12) return false;',
  '  if (!/[A-Z]/.test(password)) return false;',
  '  if (!/[0-9]/.test(password)) return false;',
  '  if (!/[!@#$%^&*]/.test(password)) return false;',
  '  return true;',
  '}',
  '',
  'export function passwordRequirements() {',
  '  return "12 chars, uppercase, number, special char";',
  '}',
  '',
].join('\n');

const AUTH_BYPASS_AFTER = [
  'export async function requireAdmin(req, res, next) {',
  '  if (!req.user) return res.status(401).send("Unauthorized");',
  '  if (req.query.debug === "true") return next();',
  '  return next();',
  '}',
  '',
].join('\n');

const CLEAN_ERROR_HANDLING_AFTER = [
  'export async function sendInvoice(invoiceId: string) {',
  '  const invoice = await invoiceRepository.findById(invoiceId);',
  '  if (!invoice) {',
  '    throw new Error("Invoice not found");',
  '  }',
  '',
  '  await emailClient.send(invoice.email, renderInvoice(invoice));',
  '  return { sent: true };',
  '}',
  '',
].join('\n');

const CLEAN_JSDOC_AFTER = [
  '/**',
  ' * Adds two numbers together.',
  ' *',
  ' * @param a - The first number',
  ' * @param b - The second number',
  ' * @returns The sum of a and b',
  ' */',
  'export function add(a: number, b: number): number {',
  '  return a + b;',
  '}',
  '',
].join('\n');

const CLEAN_OPTIONAL_CHAINING_AFTER = [
  'export async function getUser(req, res) {',
  '  const { email } = req.query;',
  '  const user = await db.user.findUnique({ where: { email } });',
  '  const avatar = user?.profile?.avatar ?? null;',
  '  res.json({ avatar });',
  '}',
  '',
].join('\n');

const CLEAN_TYPE_ANNOTATION_AFTER = [
  'interface PaymentConfig {',
  '  apiKey: string;',
  '  webhookToleranceMs: number;',
  '}',
  '',
  'export const paymentConfig: PaymentConfig = {',
  '  apiKey: process.env.STRIPE_API_KEY,',
  '  webhookToleranceMs: 300000,',
  '};',
  '',
].join('\n');

export const reviewerDataset: ReviewerDatasetItem[] = [
  {
    id: 'sql-injection-user-lookup',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-101',
      taskTitle: 'Add user lookup by email',
      branchName: 'ENG-101/user-lookup',
      changedFiles: ['src/routes/users.ts'],
      diff: SQL_INJECTION_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['sql-injection', 'input-validation'],
      changedFiles: ['src/routes/users.ts'],
      afterFiles: { 'src/routes/users.ts': SQL_INJECTION_AFTER },
    },
  },
  {
    id: 'hardcoded-payment-secret',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-102',
      taskTitle: 'Configure payment provider',
      branchName: 'ENG-102/payment-config',
      changedFiles: ['src/config/payments.ts'],
      diff: HARDCODED_SECRET_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['hardcoded-secret'],
      changedFiles: ['src/config/payments.ts'],
      afterFiles: { 'src/config/payments.ts': HARDCODED_SECRET_AFTER },
    },
  },
  {
    id: 'profile-xss',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-103',
      taskTitle: 'Render rich profile bios',
      branchName: 'ENG-103/profile-bio-html',
      changedFiles: ['src/components/Profile.tsx'],
      diff: XSS_VULNERABILITY_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['xss', 'unsafe-html'],
      changedFiles: ['src/components/Profile.tsx'],
      afterFiles: { 'src/components/Profile.tsx': XSS_AFTER },
    },
  },
  {
    id: 'clean-name-format-refactor',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-104',
      taskTitle: 'Refactor display name formatting',
      branchName: 'ENG-104/name-format-refactor',
      changedFiles: ['src/utils/format.ts'],
      diff: CLEAN_REFACTOR_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'approve',
      isClean: true,
      expectedIssues: [],
      changedFiles: ['src/utils/format.ts'],
      afterFiles: { 'src/utils/format.ts': CLEAN_REFACTOR_AFTER },
    },
  },
  {
    id: 'password-rules-without-tests',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-105',
      taskTitle: 'Require special characters in passwords',
      branchName: 'ENG-105/password-special-char',
      changedFiles: ['src/auth/password.ts'],
      diff: NO_TESTS_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['missing-tests'],
      changedFiles: ['src/auth/password.ts'],
      afterFiles: { 'src/auth/password.ts': NO_TESTS_AFTER },
    },
  },
  {
    id: 'admin-auth-bypass',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-106',
      taskTitle: 'Add debug mode to admin middleware',
      branchName: 'ENG-106/admin-debug-mode',
      changedFiles: ['src/middleware/auth.ts'],
      diff: AUTH_BYPASS_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['authorization-bypass'],
      changedFiles: ['src/middleware/auth.ts'],
      afterFiles: { 'src/middleware/auth.ts': AUTH_BYPASS_AFTER },
    },
  },
  {
    id: 'clean-invoice-error-handling',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-107',
      taskTitle: 'Handle missing invoices explicitly',
      branchName: 'ENG-107/invoice-not-found',
      changedFiles: ['src/services/invoices.ts'],
      diff: CLEAN_ERROR_HANDLING_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'approve',
      isClean: true,
      expectedIssues: [],
      changedFiles: ['src/services/invoices.ts'],
      afterFiles: { 'src/services/invoices.ts': CLEAN_ERROR_HANDLING_AFTER },
    },
  },
  {
    id: 'sql-injection-report-export',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-108',
      taskTitle: 'Filter report exports by owner',
      branchName: 'ENG-108/report-owner-filter',
      changedFiles: ['src/routes/users.ts'],
      diff: SQL_INJECTION_DIFF.replace('users WHERE email', 'reports WHERE owner_email'),
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['sql-injection'],
      changedFiles: ['src/routes/users.ts'],
      afterFiles: {
        'src/routes/users.ts': SQL_INJECTION_AFTER.replace('users', 'reports').replace(
          'email',
          'owner_email'
        ),
      },
    },
  },
  {
    id: 'clean-format-refactor-second',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-109',
      taskTitle: 'Simplify display name utility',
      branchName: 'ENG-109/simplify-display-name',
      changedFiles: ['src/utils/format.ts'],
      diff: CLEAN_REFACTOR_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'approve',
      isClean: true,
      expectedIssues: [],
      changedFiles: ['src/utils/format.ts'],
      afterFiles: { 'src/utils/format.ts': CLEAN_REFACTOR_AFTER },
    },
  },
  {
    id: 'xss-admin-preview',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-110',
      taskTitle: 'Preview admin announcement HTML',
      branchName: 'ENG-110/admin-announcement-preview',
      changedFiles: ['src/components/Profile.tsx'],
      diff: XSS_VULNERABILITY_DIFF.replace('Profile', 'AnnouncementPreview').replace('bio', 'html'),
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['xss', 'unsafe-html'],
      changedFiles: ['src/components/Profile.tsx'],
      afterFiles: {
        'src/components/Profile.tsx': XSS_AFTER.replace('Profile', 'AnnouncementPreview').replace(
          'bio',
          'html'
        ),
      },
    },
  },
  {
    id: 'clean-add-jsdoc',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-111',
      taskTitle: 'Add JSDoc to math utilities',
      branchName: 'ENG-111/jsdoc-math',
      changedFiles: ['src/utils/math.ts'],
      diff: CLEAN_JSDOC_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'approve',
      isClean: true,
      expectedIssues: [],
      changedFiles: ['src/utils/math.ts'],
      afterFiles: { 'src/utils/math.ts': CLEAN_JSDOC_AFTER },
    },
  },
  {
    id: 'clean-optional-chaining',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-112',
      taskTitle: 'Refactor user lookup with optional chaining',
      branchName: 'ENG-112/optional-chaining',
      changedFiles: ['src/routes/users.ts'],
      diff: CLEAN_OPTIONAL_CHAINING_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'approve',
      isClean: true,
      expectedIssues: [],
      changedFiles: ['src/routes/users.ts'],
      beforeFiles: {
        'src/routes/users.ts': [
          'export async function getUser(req, res) {',
          '  const { email } = req.query;',
          '  const user = await db.user.findUnique({ where: { email } });',
          '  if (user && user.profile && user.profile.avatar) {',
          '    res.json({ avatar: user.profile.avatar });',
          '  } else {',
          '    res.json({ avatar: null });',
          '  }',
          '}',
          '',
        ].join('\n'),
      },
      afterFiles: { 'src/routes/users.ts': CLEAN_OPTIONAL_CHAINING_AFTER },
    },
  },
  {
    id: 'clean-type-annotation',
    input: createReviewerPrompt({
      taskIdentifier: 'ENG-113',
      taskTitle: 'Add type annotations to payment config',
      branchName: 'ENG-113/payment-config-types',
      changedFiles: ['src/config/payments.ts'],
      diff: CLEAN_TYPE_ANNOTATION_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'approve',
      isClean: true,
      expectedIssues: [],
      changedFiles: ['src/config/payments.ts'],
      afterFiles: { 'src/config/payments.ts': CLEAN_TYPE_ANNOTATION_AFTER },
    },
  },
];
