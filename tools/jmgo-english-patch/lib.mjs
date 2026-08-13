import { createHash } from "node:crypto";

export const CJK_PATTERN = /[\u3400-\u9fff]/u;

const RESOURCE_HEADER = /^    resource 0x[0-9a-f]+ ([^/]+)\/(.+)$/u;
const CONFIG_HEADER = /^      \(([^)]*)\) (?!\(array\) )(.*)$/u;
const ARRAY_HEADER = /^      \(([^)]*)\) \(array\) size=(\d+)$/u;
const FORMAT_PATTERN = /%%|%(?:\d+\$)?[-#+0,(<]*\d*(?:\.\d+)?[bBhHsScCdoxXeEfgGaAtTn]/gu;

function removeDumpIndent(line) {
  return line.startsWith("      ") ? line.slice(6) : line;
}

function parseStringConfiguration(lines) {
  const match = CONFIG_HEADER.exec(lines[0] ?? "");
  if (!match) return undefined;

  const config = match[1];
  const continuation = lines.slice(1).map(removeDumpIndent);
  while (continuation.at(-1) === "") continuation.pop();
  let payload = [match[2], ...continuation].join("\n");
  if (payload.startsWith("(styled string) ")) {
    payload = payload.slice("(styled string) ".length);
    const dataIndex = payload.lastIndexOf('" Data:');
    if (!payload.startsWith('"') || dataIndex < 1) return undefined;
    return { config, value: payload.slice(1, dataIndex) };
  }

  if (!payload.startsWith('"') || !payload.endsWith('"')) return undefined;
  return { config, value: payload.slice(1, -1) };
}

function parseArrayValues(payload, expectedSize) {
  const values = [];
  const pattern = /"([\s\S]*?)"(?=\s*(?:,|\]))/gu;
  for (const match of payload.matchAll(pattern)) values.push(match[1]);
  return values.length === expectedSize ? values : undefined;
}

export function parseAapt2Resources(output) {
  const lines = output.split(/\r?\n/u);
  const resources = { strings: {}, arrays: {} };

  for (let index = 0; index < lines.length;) {
    const header = RESOURCE_HEADER.exec(lines[index] ?? "");
    if (!header) {
      index += 1;
      continue;
    }

    const [, type, name] = header;
    let end = index + 1;
    while (
      end < lines.length &&
      !RESOURCE_HEADER.test(lines[end] ?? "") &&
      !(lines[end] ?? "").startsWith("  type ")
    ) {
      end += 1;
    }
    const block = lines.slice(index + 1, end);

    if (type === "string") {
      const starts = [];
      for (let offset = 0; offset < block.length; offset += 1) {
        if (CONFIG_HEADER.test(block[offset] ?? "")) starts.push(offset);
      }
      const configurations = {};
      for (let position = 0; position < starts.length; position += 1) {
        const start = starts[position];
        const stop = starts[position + 1] ?? block.length;
        const parsed = parseStringConfiguration(block.slice(start, stop));
        if (parsed) configurations[parsed.config] = parsed.value;
      }
      resources.strings[name] = configurations;
    }

    if (type === "array") {
      const starts = [];
      for (let offset = 0; offset < block.length; offset += 1) {
        if (ARRAY_HEADER.test(block[offset] ?? "")) starts.push(offset);
      }
      const configurations = {};
      for (let position = 0; position < starts.length; position += 1) {
        const start = starts[position];
        const stop = starts[position + 1] ?? block.length;
        const match = ARRAY_HEADER.exec(block[start] ?? "");
        if (!match) continue;
        const values = parseArrayValues(block.slice(start + 1, stop).join("\n"), Number(match[2]));
        if (values) configurations[match[1]] = values;
      }
      resources.arrays[name] = configurations;
    }

    index = end;
  }

  return resources;
}

function sortRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

export function sourceView(resources, catalog) {
  const strings = {};
  for (const name of Object.keys(catalog.strings ?? {}).sort()) {
    const value = resources.strings[name]?.[""];
    if (value === undefined) throw new Error(`Target is missing default string/${name}`);
    strings[name] = value;
  }

  const arrays = {};
  for (const name of Object.keys(catalog.arrays ?? {}).sort()) {
    const value = resources.arrays[name]?.[""];
    if (value === undefined) throw new Error(`Target is missing default array/${name}`);
    arrays[name] = value;
  }

  return { strings, arrays };
}

export function sourceFingerprint(resources, catalog) {
  const stable = sourceView(resources, catalog);
  return createHash("sha256").update(JSON.stringify(stable), "utf8").digest("hex");
}

export function formatSignature(value) {
  return [...value.matchAll(FORMAT_PATTERN)].map((match) => match[0]).sort();
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function translatableInventory(resources) {
  const strings = Object.fromEntries(
    Object.entries(resources.strings)
      .filter(([, configs]) => CJK_PATTERN.test(configs[""] ?? ""))
      .map(([name, configs]) => [name, configs[""]])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const arrays = Object.fromEntries(
    Object.entries(resources.arrays)
      .filter(([, configs]) => (configs[""] ?? []).some((value) => CJK_PATTERN.test(value)))
      .map(([name, configs]) => [name, configs[""]])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return { strings, arrays };
}

export function validateCatalog(resources, catalog, target) {
  const errors = [];
  const inventory = translatableInventory(resources);
  const catalogStringNames = Object.keys(catalog.strings ?? {}).sort();
  const sourceStringNames = Object.keys(inventory.strings).sort();
  const catalogArrayNames = Object.keys(catalog.arrays ?? {}).sort();
  const sourceArrayNames = Object.keys(inventory.arrays).sort();

  if (!sameStrings(catalogStringNames, sourceStringNames)) {
    const missing = sourceStringNames.filter((name) => !catalogStringNames.includes(name));
    const extra = catalogStringNames.filter((name) => !sourceStringNames.includes(name));
    errors.push(`string inventory differs (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`);
  }
  if (!sameStrings(catalogArrayNames, sourceArrayNames)) {
    const missing = sourceArrayNames.filter((name) => !catalogArrayNames.includes(name));
    const extra = catalogArrayNames.filter((name) => !sourceArrayNames.includes(name));
    errors.push(`array inventory differs (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`);
  }

  for (const [name, translation] of Object.entries(catalog.strings ?? {})) {
    const source = resources.strings[name]?.[""];
    if (typeof translation !== "string" || translation.trim() === "") {
      errors.push(`string/${name} has an empty or non-string translation`);
      continue;
    }
    if (CJK_PATTERN.test(translation)) errors.push(`string/${name} still contains CJK text`);
    if (source !== undefined && !sameStrings(formatSignature(source), formatSignature(translation))) {
      errors.push(`string/${name} changed format placeholders`);
    }
  }

  for (const [name, translations] of Object.entries(catalog.arrays ?? {})) {
    const source = resources.arrays[name]?.[""];
    if (!Array.isArray(translations) || !source || translations.length !== source.length) {
      errors.push(`array/${name} does not match the target length`);
      continue;
    }
    translations.forEach((translation, index) => {
      if (typeof translation !== "string") {
        errors.push(`array/${name}[${index}] has a non-string translation`);
      } else if (translation.trim() === "" && source[index].trim() !== "") {
        errors.push(`array/${name}[${index}] unexpectedly has an empty translation`);
      } else if (CJK_PATTERN.test(translation)) {
        errors.push(`array/${name}[${index}] still contains CJK text`);
      }
      if (!sameStrings(formatSignature(source[index]), formatSignature(translation))) {
        errors.push(`array/${name}[${index}] changed format placeholders`);
      }
    });
  }

  for (const [source, translation] of Object.entries(catalog.accessibility ?? {})) {
    if (!CJK_PATTERN.test(source)) errors.push(`accessibility/${source} has no CJK source text`);
    if (typeof translation !== "string" || translation.trim() === "") {
      errors.push(`accessibility/${source} has an empty or non-string translation`);
      continue;
    }
    if (CJK_PATTERN.test(translation)) errors.push(`accessibility/${source} still contains CJK text`);
    if (!sameStrings(formatSignature(source), formatSignature(translation))) {
      errors.push(`accessibility/${source} changed format placeholders`);
    }
  }

  const fingerprint = sourceFingerprint(resources, catalog);
  if (target.sourceFingerprintSha256 && fingerprint !== target.sourceFingerprintSha256) {
    errors.push(`source fingerprint is ${fingerprint}, expected ${target.sourceFingerprintSha256}`);
  }
  if (target.counts?.strings !== sourceStringNames.length || target.counts?.arrays !== sourceArrayNames.length) {
    errors.push(`source count is ${sourceStringNames.length} strings/${sourceArrayNames.length} arrays, expected ${target.counts?.strings}/${target.counts?.arrays}`);
  }

  if (errors.length > 0) throw new Error(`${target.id} catalog validation failed:\n- ${errors.join("\n- ")}`);
  return { fingerprint, strings: sourceStringNames.length, arrays: sourceArrayNames.length };
}

export function normalizeAccessibilityText(value) {
  return value.replaceAll("\u00a0", " ").replace(/\s+/gu, " ").trim();
}

function stripMarkup(value) {
  return value.replace(/<[^>]+>/gu, "");
}

export function buildAccessibilityCatalog(targets, resourcesById, catalogsById) {
  const packages = {};
  const conflicts = [];
  for (const target of targets) {
    const resources = resourcesById[target.id];
    const catalog = catalogsById[target.id];
    const exact = {};
    const templates = [];

    const add = (sourceValue, translatedValue, key) => {
      const source = normalizeAccessibilityText(stripMarkup(sourceValue));
      const translation = normalizeAccessibilityText(stripMarkup(translatedValue));
      if (!source || !CJK_PATTERN.test(source) || !translation) return;
      if (formatSignature(sourceValue).length > 0) {
        templates.push({ source, translation, key });
        return;
      }
      const existing = exact[source];
      if (existing !== undefined && existing !== translation) {
        conflicts.push(`${target.id}:${key}`);
      } else {
        exact[source] = translation;
      }
    };

    for (const [source, translation] of Object.entries(catalog.accessibility ?? {})) {
      add(source, translation, `accessibility/${source}`);
    }
    for (const [name, translation] of Object.entries(catalog.strings ?? {})) {
      add(resources.strings[name][""], translation, `string/${name}`);
    }
    for (const [name, translations] of Object.entries(catalog.arrays ?? {})) {
      resources.arrays[name][""].forEach((source, index) => add(source, translations[index], `array/${name}[${index}]`));
    }

    packages[target.packageName] = {
      exact: sortRecord(exact),
      templates: templates.sort((left, right) => left.key.localeCompare(right.key)),
    };
  }
  return { schemaVersion: 1, packages, conflicts };
}
