import zh from './zh';
import en from './en';

export type SupportedLanguage = 'zh' | 'en';

const translations: Record<SupportedLanguage, Record<string, string>> = { zh, en };
const fallbackLang: SupportedLanguage = 'en';

export function t(key: string, lang: SupportedLanguage = 'en'): string {
  return translations[lang]?.[key] ?? translations[fallbackLang]?.[key] ?? key;
}

export function getLanguageLabel(lang: SupportedLanguage): string {
  return lang === 'zh' ? '中文' : 'EN';
}

export { zh, en };