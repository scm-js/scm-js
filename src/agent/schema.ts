/**
 * A JSON Schema subset, enough for the agent's tool inputs, and a validator for it.
 *
 * The tools are sent with `eager_input_streaming`, so their inputs stream as Claude writes
 * them and the API no longer validates them against the schema. A tolerant parser can also
 * hand back a silently truncated object. So every input is checked here before its tool
 * runs, and a failure goes back to Claude as an error result to correct.
 */
export type JsonSchema =
  | { type: "object"; description?: string; properties: Record<string, JsonSchema>; required?: string[]; additionalProperties?: boolean }
  | { type: "array"; description?: string; items: JsonSchema; minItems?: number; maxItems?: number }
  | { type: "string"; description?: string; enum?: readonly string[]; maxLength?: number }
  | { type: "integer" | "number"; description?: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description?: string };

export function validate(schema: JsonSchema, value: unknown, path = "input"): string[] {
  const errors: string[] = [];
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path} must be an object`];
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) if (obj[key] === undefined) errors.push(`${path}.${key} is required`);
      for (const [key, v] of Object.entries(obj)) {
        const sub = schema.properties[key];
        if (!sub) {
          if (schema.additionalProperties === false) errors.push(`${path}.${key} is not a known field`);
          continue;
        }
        if (v === undefined || v === null) continue;
        errors.push(...validate(sub, v, `${path}.${key}`));
      }
      return errors;
    }
    case "array": {
      if (!Array.isArray(value)) return [`${path} must be an array`];
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} item(s)`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} takes at most ${schema.maxItems} items`);
      value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
      return errors.slice(0, 20);
    }
    case "string":
      if (typeof value !== "string") return [`${path} must be a string`];
      if (schema.enum && !schema.enum.includes(value)) return [`${path} must be one of: ${schema.enum.join(", ")}`];
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return [`${path} is longer than ${schema.maxLength} characters`];
      return [];
    case "integer":
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return [`${path} must be a number`];
      if (schema.type === "integer" && !Number.isInteger(value)) return [`${path} must be a whole number`];
      if (schema.minimum !== undefined && value < schema.minimum) return [`${path} must be at least ${schema.minimum}`];
      if (schema.maximum !== undefined && value > schema.maximum) return [`${path} must be at most ${schema.maximum}`];
      return [];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${path} must be true or false`];
  }
}

/* ── Small builders, so the tool files read as data ─────── */

export const obj = (properties: Record<string, JsonSchema>, required: string[] = [], description?: string): JsonSchema =>
  ({ type: "object", properties, required, additionalProperties: false, ...(description ? { description } : {}) });
export const arr = (items: JsonSchema, description?: string, maxItems?: number): JsonSchema =>
  ({ type: "array", items, ...(description ? { description } : {}), ...(maxItems ? { maxItems } : {}) });
export const str = (description?: string, values?: readonly string[]): JsonSchema =>
  ({ type: "string", ...(description ? { description } : {}), ...(values ? { enum: values } : {}) });
export const int = (description?: string, minimum?: number, maximum?: number): JsonSchema =>
  ({ type: "integer", ...(description ? { description } : {}), ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}) });
export const num = (description?: string, minimum?: number, maximum?: number): JsonSchema =>
  ({ type: "number", ...(description ? { description } : {}), ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}) });
export const bool = (description?: string): JsonSchema => ({ type: "boolean", ...(description ? { description } : {}) });

/** A tile rectangle; x1 / y1 are exclusive, as everywhere in the editor. */
export const tileRect = (description = "A tile rectangle; x1 and y1 are exclusive (x0 0, x1 4 covers tiles 0 to 3).") =>
  obj({ x0: int(undefined, 0, 256), y0: int(undefined, 0, 256), x1: int(undefined, 0, 256), y1: int(undefined, 0, 256) }, ["x0", "y0", "x1", "y1"], description);
