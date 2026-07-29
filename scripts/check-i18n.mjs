import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const localesDir = join(rootDir, 'public', '_locales');
const localeNames = (await readdir(localesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));
const localeMessages = new Map();

for (const localeName of localeNames) {
  localeMessages.set(
    localeName,
    await readJson(join(localesDir, localeName, 'messages.json')),
  );
}

const defaultLocale = 'en';
const defaultMessages = localeMessages.get(defaultLocale);

if (!defaultMessages) {
  throw new Error(`Missing default locale: ${defaultLocale}`);
}

const defaultKeys = Object.keys(defaultMessages).sort();
const placeholderPattern = /\$([A-Z0-9_]+)\$/g;

function getReferencedPlaceholders(message) {
  return Array.from(message.matchAll(placeholderPattern), (match) => match[1].toLowerCase()).sort();
}

function getDefinedPlaceholders(entry) {
  return Object.keys(entry.placeholders ?? {}).map((key) => key.toLowerCase()).sort();
}

function assertSameValues(actual, expected, context) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${context}: expected [${expected.join(', ')}], received [${actual.join(', ')}]`);
  }
}

async function collectSourceFiles(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(entryPath));
    } else if (['.html', '.ts', '.tsx'].includes(extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

for (const [localeName, messages] of localeMessages) {
  const localeKeys = Object.keys(messages).sort();
  assertSameValues(localeKeys, defaultKeys, `${localeName} message keys`);

  for (const key of defaultKeys) {
    const entry = messages[key];
    const defaultEntry = defaultMessages[key];

    if (!entry || typeof entry.message !== 'string' || !entry.message.trim()) {
      throw new Error(`${localeName}.${key} must contain a non-empty message`);
    }

    const referencedPlaceholders = getReferencedPlaceholders(entry.message);
    const definedPlaceholders = getDefinedPlaceholders(entry);
    assertSameValues(definedPlaceholders, referencedPlaceholders, `${localeName}.${key} placeholders`);

    const defaultPlaceholderNames = getDefinedPlaceholders(defaultEntry);
    assertSameValues(definedPlaceholders, defaultPlaceholderNames, `${localeName}.${key} placeholder names`);

    for (const placeholderName of defaultPlaceholderNames) {
      const content = entry.placeholders?.[placeholderName]?.content;
      const defaultContent = defaultEntry.placeholders?.[placeholderName]?.content;
      if (content !== defaultContent) {
        throw new Error(`${localeName}.${key}.${placeholderName} must use content ${defaultContent}`);
      }
    }
  }
}

const sourceFiles = [
  join(rootDir, 'wxt.config.ts'),
  ...await collectSourceFiles(join(rootDir, 'entrypoints')),
  ...await collectSourceFiles(join(rootDir, 'lib')),
];
const referencedKeys = new Set();
const messageCallPattern = /\b(?:localizeDocument|t)\(\s*['"]([A-Za-z0-9_]+)['"]/g;
const manifestMessagePattern = /__MSG_([A-Za-z0-9_]+)__/g;

for (const sourceFile of sourceFiles) {
  const source = await readFile(sourceFile, 'utf8');
  for (const pattern of [messageCallPattern, manifestMessagePattern]) {
    for (const match of source.matchAll(pattern)) {
      referencedKeys.add(match[1]);
    }
  }
}

const missingKeys = [...referencedKeys].filter((key) => !defaultMessages[key]).sort();
if (missingKeys.length > 0) {
  throw new Error(`Source references missing i18n messages: ${missingKeys.join(', ')}`);
}

const unusedKeys = defaultKeys.filter((key) => !referencedKeys.has(key));
if (unusedKeys.length > 0) {
  throw new Error(`Unused i18n messages: ${unusedKeys.join(', ')}`);
}

console.log(
  `i18n validation passed for ${localeNames.length} locales, ${defaultKeys.length} messages, and ${sourceFiles.length} source files.`,
);
