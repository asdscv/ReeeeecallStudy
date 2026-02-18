// i18n type augmentation
// Using loose typing to support dynamic translation keys
// while still providing namespace awareness

import 'i18next'
import 'react-i18next'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    returnNull: false
  }
}

// Fix react-i18next children type conflict with React 19
declare module 'react-i18next' {
  interface CustomTypeOptions {
    allowObjectInHTMLChildren: true
  }
}
