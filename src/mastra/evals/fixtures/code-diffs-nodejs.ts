export const SQL_INJECTION_DIFF = `diff --git a/src/routes/users.ts b/src/routes/users.ts
index 0a1b2c3..4d5e6f7 100644
--- a/src/routes/users.ts
+++ b/src/routes/users.ts
@@ -10,8 +10,10 @@ export async function getUser(req, res) {
   const { email } = req.query;
-  const user = await db.user.findUnique({ where: { email } });
+  const rows = await db.query(
+    "SELECT * FROM users WHERE email = '" + email + "' LIMIT 1"
+  );
+  const user = rows[0];
   res.json(user);
 }`;

export const HARDCODED_SECRET_DIFF = `diff --git a/src/config/payments.ts b/src/config/payments.ts
index 1111111..2222222 100644
--- a/src/config/payments.ts
+++ b/src/config/payments.ts
@@ -1,4 +1,5 @@
 export const paymentConfig = {
-  apiKey: process.env.STRIPE_API_KEY,
+  apiKey: "sk_live_51N8xHardcodedSecretValue",
   webhookToleranceMs: 300000,
 };`;

export const XSS_VULNERABILITY_DIFF = `diff --git a/src/components/Profile.tsx b/src/components/Profile.tsx
index 3333333..4444444 100644
--- a/src/components/Profile.tsx
+++ b/src/components/Profile.tsx
@@ -3,7 +3,10 @@ type Props = { bio: string };

 export function Profile({ bio }: Props) {
-  return <p>{bio}</p>;
+  return (
+    <section dangerouslySetInnerHTML={{ __html: bio }} />
+  );
 }`;

export const CLEAN_REFACTOR_DIFF = `diff --git a/src/utils/format.ts b/src/utils/format.ts
index 5555555..6666666 100644
--- a/src/utils/format.ts
+++ b/src/utils/format.ts
@@ -1,6 +1,8 @@
 export function formatDisplayName(firstName: string, lastName: string) {
-  const first = firstName.trim();
-  const last = lastName.trim();
-  return [first, last].filter(Boolean).join(" ");
+  return [firstName, lastName]
+    .map((part) => part.trim())
+    .filter(Boolean)
+    .join(" ");
 }`;

export const NO_TESTS_DIFF = `diff --git a/src/auth/password.ts b/src/auth/password.ts
index 7777777..8888888 100644
--- a/src/auth/password.ts
+++ b/src/auth/password.ts
@@ -4,6 +4,10 @@ export function validatePassword(password: string) {
   if (password.length < 12) return false;
   if (!/[A-Z]/.test(password)) return false;
   if (!/[0-9]/.test(password)) return false;
+  if (!/[!@#$%^&*]/.test(password)) return false;
   return true;
 }
+
+export function passwordRequirements() {
+  return "12 chars, uppercase, number, special char";
+}`;

export const AUTH_BYPASS_DIFF = `diff --git a/src/middleware/auth.ts b/src/middleware/auth.ts
index 9999999..aaaaaaa 100644
--- a/src/middleware/auth.ts
+++ b/src/middleware/auth.ts
@@ -8,7 +8,7 @@ export async function requireAdmin(req, res, next) {
   if (!req.user) return res.status(401).send("Unauthorized");
-  if (req.user.role !== "admin") return res.status(403).send("Forbidden");
+  if (req.query.debug === "true") return next();
   return next();
 }`;

export const CLEAN_ERROR_HANDLING_DIFF = `diff --git a/src/services/invoices.ts b/src/services/invoices.ts
index bbbbbbb..ccccccc 100644
--- a/src/services/invoices.ts
+++ b/src/services/invoices.ts
@@ -12,7 +12,11 @@ export async function sendInvoice(invoiceId: string) {
   const invoice = await invoiceRepository.findById(invoiceId);
-  await emailClient.send(invoice.email, renderInvoice(invoice));
+  if (!invoice) {
+    throw new Error("Invoice not found");
+  }
+
+  await emailClient.send(invoice.email, renderInvoice(invoice));
   return { sent: true };
 }`;

export const CLEAN_JSDOC_DIFF = `diff --git a/src/utils/math.ts b/src/utils/math.ts
index ddddddd..eeeeeee 100644
--- a/src/utils/math.ts
+++ b/src/utils/math.ts
@@ -1,3 +1,11 @@
+/**
+ * Adds two numbers together.
+ *
+ * @param a - The first number
+ * @param b - The second number
+ * @returns The sum of a and b
+ */
 export function add(a: number, b: number) {
   return a + b;
 }`;

export const CLEAN_OPTIONAL_CHAINING_DIFF = `diff --git a/src/routes/users.ts b/src/routes/users.ts
index fffffff..0000000 100644
--- a/src/routes/users.ts
+++ b/src/routes/users.ts
@@ -10,8 +10,7 @@ const { email } = req.query;
-  const user = await db.user.findUnique({ where: { email } });
-  if (user && user.profile && user.profile.avatar) {
-    res.json({ avatar: user.profile.avatar });
-  } else {
-    res.json({ avatar: null });
-  }
+  const user = await db.user.findUnique({ where: { email } });
+  const avatar = user?.profile?.avatar ?? null;
+  res.json({ avatar });
 }`;

export const CLEAN_TYPE_ANNOTATION_DIFF = `diff --git a/src/config/payments.ts b/src/config/payments.ts
index 1111111..2222222 100644
--- a/src/config/payments.ts
+++ b/src/config/payments.ts
@@ -1,4 +1,13 @@
-export const paymentConfig = {
+interface PaymentConfig {
+  apiKey: string;
+  webhookToleranceMs: number;
+}
+
+export const paymentConfig: PaymentConfig = {
   apiKey: process.env.STRIPE_API_KEY,
   webhookToleranceMs: 300000,
 }`;
