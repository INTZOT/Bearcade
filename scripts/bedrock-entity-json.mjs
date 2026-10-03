import { randomUUID } from 'node:crypto';

// Bedrock actor properties distinguish JSON integer tokens from float tokens.
// Keep this compatible with Node 18/20: JSON.rawJSON is not available there.
export function stringifyBedrockEntity(value) {
  const floatFields = new Map();
  for (const property of Object.values(value['minecraft:entity']?.description?.properties ?? {})) {
    if (property.type !== 'float') continue;
    floatFields.set(property, new Set(['default']));
    if (Array.isArray(property.range)) floatFields.set(property.range, new Set(['0', '1']));
  }
  if (floatFields.size === 0) return JSON.stringify(value, null, 2);
  const prefix = `__bedrock_float_${randomUUID()}_`;
  const tokens = [];
  const json = JSON.stringify(value, function (key, item) {
    if (typeof item !== 'number' || !floatFields.get(this)?.has(key)) return item;
    if (!Number.isFinite(item)) throw new Error('Entity float property must be finite');
    const token = String(item);
    tokens.push(/[.eE]/.test(token) ? token : `${token}.0`);
    return `${prefix}${tokens.length - 1}__`;
  }, 2);
  // Only replace our fresh quoted placeholders, never numbers in strings/Molang.
  return json.replace(new RegExp(`"${prefix}(\\d+)__"`, 'g'), (_, i) => tokens[Number(i)]);
}

// Preserve numeric lexemes without needing JSON.parse's Node 22+ source context.
// Complete quoted strings are consumed first, so digits inside strings are untouched.
export function entityFloatTokenErrors(source) {
  JSON.parse(source); // Reject invalid JSON before inspecting its numeric tokens.
  const lexical = JSON.parse(source.replace(
    /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    token => token.startsWith('"') ? token : JSON.stringify({ numberToken: token }),
  ));
  const errors = [];
  for (const [name, property] of Object.entries(lexical['minecraft:entity']?.description?.properties ?? {})) {
    if (property.type !== 'float') continue;
    const check = (value, field) => {
      if (value?.numberToken && !/[.eE]/.test(value.numberToken)) {
        errors.push(`${name}.${field}: float 属性不能写整数 token ${value.numberToken}，请写 ${value.numberToken}.0`);
      }
    };
    check(property.default, 'default');
    property.range?.forEach((value, i) => check(value, `range[${i}]`));
  }
  return errors;
}
