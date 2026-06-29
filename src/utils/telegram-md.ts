const MARKDOWN_SPECIAL = /([_*`[]])/g;

/** Escape Telegram legacy Markdown special characters in user/AI-generated content */
export function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_SPECIAL, '\\$1');
}
