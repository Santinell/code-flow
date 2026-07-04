// Python-аналог code-diffs.ts. Те же 10 сценариев проверки reviewer-агента,
// но в Python-конвенциях: f-string SQL-инъекция, mark_safe (XSS), docstring
// вместо JSDoc, ValueError вместо throw, type hints/dataclass вместо interface.
// Scorer'ы языково-нейтральны, поэтому expectedIssues-теги сохранены.

export const SQL_INJECTION_DIFF = `diff --git a/src/routes/users.py b/src/routes/users.py
index 0a1b2c3..4d5e6f7 100644
--- a/src/routes/users.py
+++ b/src/routes/users.py
@@ -10,7 +10,9 @@ async def get_user(req, res):
     email = req.query["email"]
-    user = await db.user.find_unique(where={"email": email})
+    rows = await db.query(
+        f"SELECT * FROM users WHERE email = '{email}' LIMIT 1"
+    )
+    user = rows[0] if rows else None
     return res.json(user)`;

export const HARDCODED_SECRET_DIFF = `diff --git a/src/config/payments.py b/src/config/payments.py
index 1111111..2222222 100644
--- a/src/config/payments.py
+++ b/src/config/payments.py
@@ -1,4 +1,5 @@
 PAYMENT_CONFIG = {
-    "api_key": os.environ["STRIPE_API_KEY"],
+    "api_key": "sk_live_51N8xHardcodedSecretValue",
     "webhook_tolerance_ms": 300000,
 }`;

// XSS через Django mark_safe / Jinja2 |safe — Python-аналог dangerouslySetInnerHTML.
export const XSS_VULNERABILITY_DIFF = `diff --git a/src/components/profile.py b/src/components/profile.py
index 3333333..4444444 100644
--- a/src/components/profile.py
+++ b/src/components/profile.py
@@ -3,7 +3,7 @@ from django.utils.safestring import mark_safe
 def render_profile(bio: str) -> str:
-    return f"<p>{bio}</p>"
+    return mark_safe(f"<section>{bio}</section>")`;

export const CLEAN_REFACTOR_DIFF = `diff --git a/src/utils/format.py b/src/utils/format.py
index 5555555..6666666 100644
--- a/src/utils/format.py
+++ b/src/utils/format.py
@@ -1,6 +1,4 @@
 def format_display_name(first_name: str, last_name: str) -> str:
-    first = first_name.strip()
-    last = last_name.strip()
-    parts = [p for p in [first, last] if p]
-    return " ".join(parts)
+    return " ".join(p.strip() for p in [first_name, last_name] if p.strip())`;

export const NO_TESTS_DIFF = `diff --git a/src/auth/password.py b/src/auth/password.py
index 7777777..8888888 100644
--- a/src/auth/password.py
+++ b/src/auth/password.py
@@ -4,9 +4,13 @@ import re
 def validate_password(password: str) -> bool:
     if len(password) < 12:
         return False
     if not re.search(r"[A-Z]", password):
         return False
     if not re.search(r"[0-9]", password):
         return False
+    if not re.search(r"[!@#$%^&*]", password):
+        return False
     return True
+
+def password_requirements() -> str:
+    return "12 chars, uppercase, number, special char"`;

export const AUTH_BYPASS_DIFF = `diff --git a/src/middleware/auth.py b/src/middleware/auth.py
index 9999999..aaaaaaa 100644
--- a/src/middleware/auth.py
+++ b/src/middleware/auth.py
@@ -8,7 +8,7 @@ async def require_admin(req, res, next):
     if not req.user:
         return res.status(401).send("Unauthorized")
-    if req.user["role"] != "admin":
-        return res.status(403).send("Forbidden")
+    if req.query.get("debug") == "true":
+        return next()
     return next()`;

export const CLEAN_ERROR_HANDLING_DIFF = `diff --git a/src/services/invoices.py b/src/services/invoices.py
index bbbbbbb..ccccccc 100644
--- a/src/services/invoices.py
+++ b/src/services/invoices.py
@@ -12,7 +12,11 @@ async def send_invoice(invoice_id: str) -> dict:
     invoice = await invoice_repository.find_by_id(invoice_id)
-    await email_client.send(invoice.email, render_invoice(invoice))
+    if not invoice:
+        raise ValueError("Invoice not found")
+
+    await email_client.send(invoice.email, render_invoice(invoice))
     return {"sent": True}`;

export const CLEAN_JSDOC_DIFF = `diff --git a/src/utils/math.py b/src/utils/math.py
index ddddddd..eeeeeee 100644
--- a/src/utils/math.py
+++ b/src/utils/math.py
@@ -1,3 +1,10 @@
+def add(a: int, b: int) -> int:
+    """Add two numbers together.
+
+    Args:
+        a: The first number.
+        b: The second number.
+
+    Returns:
+        The sum of a and b.
+    """
-def add(a: int, b: int) -> int:
     return a + b`;

// Python не имеет ?. — эквивалент «optional chaining» это getattr-chain или
// тернарный паттерн. Рефакторинг упрощает каскад None-проверок через getattr.
export const CLEAN_OPTIONAL_CHAINING_DIFF = `diff --git a/src/routes/users.py b/src/routes/users.py
index fffffff..0000000 100644
--- a/src/routes/users.py
+++ b/src/routes/users.py
@@ -10,12 +10,7 @@ email = req.query["email"]
-    user = await db.user.find_unique(where={"email": email})
-    if user is not None and user.profile is not None and user.profile.avatar is not None:
-        avatar = user.profile.avatar
-    else:
-        avatar = None
-    return res.json({"avatar": avatar})
+    user = await db.user.find_unique(where={"email": email})
+    profile = getattr(user, "profile", None) if user else None
+    avatar = getattr(profile, "avatar", None) if profile else None
+    return res.json({"avatar": avatar})`;

export const CLEAN_TYPE_ANNOTATION_DIFF = `diff --git a/src/config/payments.py b/src/config/payments.py
index 1111111..2222222 100644
--- a/src/config/payments.py
+++ b/src/config/payments.py
@@ -1,4 +1,10 @@
-from typing import TypedDict
+import os
+from typing import TypedDict
+
+
+class PaymentConfig(TypedDict):
+    api_key: str
+    webhook_tolerance_ms: int

-PAYMENT_CONFIG = {
+PAYMENT_CONFIG: PaymentConfig = {
     "api_key": os.environ["STRIPE_API_KEY"],
     "webhook_tolerance_ms": 300000,
 }`;
