import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import translations from '~/locales'

const resources = {
  en: { translation: translations.en },
  de: { translation: translations.de },
  fr: { translation: translations.fr },
}

i18n
  // detect user language
  .use(LanguageDetector)
  // passes i18n down to react-i18next
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    // debug: true,
    interpolation: {
      // react already safes from xss
      escapeValue: false,
    },
  })

export default i18n
