import { createI18n } from 'vue-i18n';
import enCA from './i18n/en-CA.json';

export const DEFAULT_LOCALE = 'en-CA';

export const messages = {
  [DEFAULT_LOCALE]: enCA
};

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages
});

export function mergeLocaleOverrides(overrides, locale = DEFAULT_LOCALE) {
  if (!overrides || typeof overrides !== 'object') return;
  const current = i18n.global.getLocaleMessage(locale) || {};
  i18n.global.setLocaleMessage(locale, deepMerge({}, current, overrides));
}

export function deepMerge(target, ...sources) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (isPlainObject(value)) {
        target[key] = deepMerge(isPlainObject(target[key]) ? target[key] : {}, value);
      } else if (Array.isArray(value)) {
        target[key] = [...value];
      } else {
        target[key] = value;
      }
    }
  }
  return target;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
