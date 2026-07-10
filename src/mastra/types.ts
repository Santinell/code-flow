/**
 * Общие JSON-типы, используемые в нескольких модулях.
 *
 * Раньше `JsonValue`/`JsonObject`/`JsonArray` дублировались локально в
 * src/evals/scorers/shared.ts и src/mastra/processors/tool-budget.ts —
 * теперь единое определение живёт здесь.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export interface JsonArray extends Array<JsonValue> {}
