import type { ReviewerVerdict } from '../../workflows/reviewer.workflow.types.js';
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
} from '../fixtures/code-diffs-python.js';

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
  'async def get_user(req, res):',
  '    email = req.query["email"]',
  '    rows = await db.query(',
  '        f"SELECT * FROM users WHERE email = \'{email}\' LIMIT 1"',
  '    )',
  '    user = rows[0] if rows else None',
  '    return res.json(user)',
  '',
].join('\n');

const HARDCODED_SECRET_AFTER = [
  'PAYMENT_CONFIG = {',
  '    "api_key": "sk_live_51N8xHardcodedSecretValue",',
  '    "webhook_tolerance_ms": 300000,',
  '}',
  '',
].join('\n');

const XSS_AFTER = [
  'from django.utils.safestring import mark_safe',
  '',
  'def render_profile(bio: str) -> str:',
  '    return mark_safe(f"<section>{bio}</section>")',
  '',
].join('\n');

const CLEAN_REFACTOR_AFTER = [
  'def format_display_name(first_name: str, last_name: str) -> str:',
  '    return " ".join(p.strip() for p in [first_name, last_name] if p.strip())',
  '',
].join('\n');

const NO_TESTS_AFTER = [
  'import re',
  '',
  '',
  'def validate_password(password: str) -> bool:',
  '    if len(password) < 12:',
  '        return False',
  '    if not re.search(r"[A-Z]", password):',
  '        return False',
  '    if not re.search(r"[0-9]", password):',
  '        return False',
  '    if not re.search(r"[!@#$%^&*]", password):',
  '        return False',
  '    return True',
  '',
  'def password_requirements() -> str:',
  '    return "12 chars, uppercase, number, special char"',
  '',
].join('\n');

const AUTH_BYPASS_AFTER = [
  'async def require_admin(req, res, next):',
  '    if not req.user:',
  '        return res.status(401).send("Unauthorized")',
  '    if req.query.get("debug") == "true":',
  '        return next()',
  '    return next()',
  '',
].join('\n');

const CLEAN_ERROR_HANDLING_AFTER = [
  'async def send_invoice(invoice_id: str) -> dict:',
  '    invoice = await invoice_repository.find_by_id(invoice_id)',
  '    if not invoice:',
  '        raise ValueError("Invoice not found")',
  '',
  '    await email_client.send(invoice.email, render_invoice(invoice))',
  '    return {"sent": True}',
  '',
].join('\n');

const CLEAN_JSDOC_AFTER = [
  'def add(a: int, b: int) -> int:',
  '    """Add two numbers together.',
  '',
  '    Args:',
  '        a: The first number.',
  '        b: The second number.',
  '',
  '    Returns:',
  '        The sum of a and b.',
  '    """',
  '    return a + b',
  '',
].join('\n');

const CLEAN_OPTIONAL_CHAINING_AFTER = [
  'async def get_user(req, res):',
  '    email = req.query["email"]',
  '    user = await db.user.find_unique(where={"email": email})',
  '    profile = getattr(user, "profile", None) if user else None',
  '    avatar = getattr(profile, "avatar", None) if profile else None',
  '    return res.json({"avatar": avatar})',
  '',
].join('\n');

const CLEAN_TYPE_ANNOTATION_AFTER = [
  'import os',
  'from typing import TypedDict',
  '',
  '',
  'class PaymentConfig(TypedDict):',
  '    api_key: str',
  '    webhook_tolerance_ms: int',
  '',
  '',
  'PAYMENT_CONFIG: PaymentConfig = {',
  '    "api_key": os.environ["STRIPE_API_KEY"],',
  '    "webhook_tolerance_ms": 300000,',
  '}',
  '',
].join('\n');

// Python-аналог reviewer-nodejs.dataset.ts. Те же 13 сценариев и expectedIssues
// (scorer'ы языково-нейтральны), но .py-диффы и afterFiles в Python-синтаксисе.
export const reviewerPythonDataset: ReviewerDatasetItem[] = [
  {
    id: 'sql-injection-user-lookup',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-101',
      taskTitle: 'Add user lookup by email',
      branchName: 'PY-101/user-lookup',
      changedFiles: ['src/routes/users.py'],
      diff: SQL_INJECTION_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['sql-injection', 'input-validation'],
      changedFiles: ['src/routes/users.py'],
      afterFiles: { 'src/routes/users.py': SQL_INJECTION_AFTER },
    },
  },
  {
    id: 'hardcoded-payment-secret',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-102',
      taskTitle: 'Configure payment provider',
      branchName: 'PY-102/payment-config',
      changedFiles: ['src/config/payments.py'],
      diff: HARDCODED_SECRET_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['hardcoded-secret'],
      changedFiles: ['src/config/payments.py'],
      afterFiles: { 'src/config/payments.py': HARDCODED_SECRET_AFTER },
    },
  },
  {
    id: 'profile-xss',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-103',
      taskTitle: 'Render rich profile bios',
      branchName: 'PY-103/profile-bio-html',
      changedFiles: ['src/components/profile.py'],
      diff: XSS_VULNERABILITY_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['xss', 'unsafe-html'],
      changedFiles: ['src/components/profile.py'],
      afterFiles: { 'src/components/profile.py': XSS_AFTER },
    },
  },
  {
    id: 'clean-name-format-refactor',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-104',
      taskTitle: 'Refactor display name formatting',
      branchName: 'PY-104/name-format-refactor',
      changedFiles: ['src/utils/format.py'],
      diff: CLEAN_REFACTOR_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'approve',
      isClean: true,
      expectedIssues: [],
      changedFiles: ['src/utils/format.py'],
      afterFiles: { 'src/utils/format.py': CLEAN_REFACTOR_AFTER },
    },
  },
  {
    id: 'password-rules-without-tests',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-105',
      taskTitle: 'Require special characters in passwords',
      branchName: 'PY-105/password-special-char',
      changedFiles: ['src/auth/password.py'],
      diff: NO_TESTS_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['missing-tests'],
      changedFiles: ['src/auth/password.py'],
      afterFiles: { 'src/auth/password.py': NO_TESTS_AFTER },
    },
  },
  {
    id: 'admin-auth-bypass',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-106',
      taskTitle: 'Add debug mode to admin middleware',
      branchName: 'PY-106/admin-debug-mode',
      changedFiles: ['src/middleware/auth.py'],
      diff: AUTH_BYPASS_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['authorization-bypass'],
      changedFiles: ['src/middleware/auth.py'],
      afterFiles: { 'src/middleware/auth.py': AUTH_BYPASS_AFTER },
    },
  },
  {
    id: 'clean-invoice-error-handling',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-107',
      taskTitle: 'Handle missing invoices explicitly',
      branchName: 'PY-107/invoice-not-found',
      changedFiles: ['src/services/invoices.py'],
      diff: CLEAN_ERROR_HANDLING_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'approve',
      isClean: true,
      expectedIssues: [],
      changedFiles: ['src/services/invoices.py'],
      afterFiles: { 'src/services/invoices.py': CLEAN_ERROR_HANDLING_AFTER },
    },
  },
  {
    id: 'sql-injection-report-export',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-108',
      taskTitle: 'Filter report exports by owner',
      branchName: 'PY-108/report-owner-filter',
      changedFiles: ['src/routes/users.py'],
      diff: SQL_INJECTION_DIFF.replace('users WHERE email', 'reports WHERE owner_email'),
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['sql-injection'],
      changedFiles: ['src/routes/users.py'],
      afterFiles: {
        'src/routes/users.py': SQL_INJECTION_AFTER.replace('users', 'reports').replace(
          'email',
          'owner_email'
        ),
      },
    },
  },
  {
    id: 'clean-format-refactor-second',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-109',
      taskTitle: 'Simplify display name utility',
      branchName: 'PY-109/simplify-display-name',
      changedFiles: ['src/utils/format.py'],
      diff: CLEAN_REFACTOR_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'approve',
      isClean: true,
      expectedIssues: [],
      changedFiles: ['src/utils/format.py'],
      afterFiles: { 'src/utils/format.py': CLEAN_REFACTOR_AFTER },
    },
  },
  {
    id: 'xss-admin-preview',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-110',
      taskTitle: 'Preview admin announcement HTML',
      branchName: 'PY-110/admin-announcement-preview',
      changedFiles: ['src/components/profile.py'],
      diff: XSS_VULNERABILITY_DIFF.replace('render_profile', 'render_announcement').replace(
        'profile',
        'announcement'
      ),
    }),
    groundTruth: {
      expectedVerdict: 'request_changes',
      isClean: false,
      expectedIssues: ['xss', 'unsafe-html'],
      changedFiles: ['src/components/profile.py'],
      afterFiles: {
        'src/components/profile.py': XSS_AFTER.replace(
          'render_profile',
          'render_announcement'
        ).replace('render_announcement(f"<section>{bio}</section>")', 'render_announcement(f"<section>{html}</section>")'),
      },
    },
  },
  {
    id: 'clean-add-docstring',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-111',
      taskTitle: 'Add docstring to math utilities',
      branchName: 'PY-111/docstring-math',
      changedFiles: ['src/utils/math.py'],
      diff: CLEAN_JSDOC_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'approve',
      isClean: true,
      expectedIssues: [],
      changedFiles: ['src/utils/math.py'],
      afterFiles: { 'src/utils/math.py': CLEAN_JSDOC_AFTER },
    },
  },
  {
    id: 'clean-optional-chaining',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-112',
      taskTitle: 'Refactor user lookup with optional chaining',
      branchName: 'PY-112/optional-chaining',
      changedFiles: ['src/routes/users.py'],
      diff: CLEAN_OPTIONAL_CHAINING_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'approve',
      isClean: true,
      expectedIssues: [],
      changedFiles: ['src/routes/users.py'],
      beforeFiles: {
        'src/routes/users.py': [
          'async def get_user(req, res):',
          '    email = req.query["email"]',
          '    user = await db.user.find_unique(where={"email": email})',
          '    if user is not None and user.profile is not None and user.profile.avatar is not None:',
          '        avatar = user.profile.avatar',
          '    else:',
          '        avatar = None',
          '    return res.json({"avatar": avatar})',
          '',
        ].join('\n'),
      },
      afterFiles: { 'src/routes/users.py': CLEAN_OPTIONAL_CHAINING_AFTER },
    },
  },
  {
    id: 'clean-type-annotation',
    input: createReviewerPrompt({
      taskIdentifier: 'PY-113',
      taskTitle: 'Add type annotations to payment config',
      branchName: 'PY-113/payment-config-types',
      changedFiles: ['src/config/payments.py'],
      diff: CLEAN_TYPE_ANNOTATION_DIFF,
    }),
    groundTruth: {
      expectedVerdict: 'approve',
      isClean: true,
      expectedIssues: [],
      changedFiles: ['src/config/payments.py'],
      afterFiles: { 'src/config/payments.py': CLEAN_TYPE_ANNOTATION_AFTER },
    },
  },
];
