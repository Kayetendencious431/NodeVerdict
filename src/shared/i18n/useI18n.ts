import { useUIStore } from '../../stores/ui-store';
import { t, type SupportedLanguage } from './index';

export function useI18n() {
  const language = useUIStore(s => s.language);

  return {
    t: (key: string) => t(key, language),
    lang: language,
  };
}