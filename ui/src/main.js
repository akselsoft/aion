import { createApp } from 'vue';
import {
  Quasar,
  ClosePopup,
  Dialog,
  Notify,
  QBtn,
  QCard,
  QCardActions,
  QCardSection,
  QChip,
  QDialog,
  QDrawer,
  QExpansionItem,
  QHeader,
  QIcon,
  QInput,
  QItem,
  QItemLabel,
  QItemSection,
  QLayout,
  QList,
  QPage,
  QPageContainer,
  QSelect,
  QSeparator,
  QSpace,
  QSpinner,
  QToggle,
  QToolbar,
  QToolbarTitle,
  QTooltip
} from 'quasar';
import '@quasar/extras/material-icons/material-icons.css';
import 'quasar/src/css/index.sass';
import './styles.css';
import App from './App.vue';
import { i18n } from './i18n';

createApp(App)
  .use(i18n)
  .use(Quasar, {
    components: {
      QBtn,
      QCard,
      QCardActions,
      QCardSection,
      QChip,
      QDialog,
      QDrawer,
      QExpansionItem,
      QHeader,
      QIcon,
      QInput,
      QItem,
      QItemLabel,
      QItemSection,
      QLayout,
      QList,
      QPage,
      QPageContainer,
      QSelect,
      QSeparator,
      QSpace,
      QSpinner,
      QToggle,
      QToolbar,
      QToolbarTitle,
      QTooltip
    },
    plugins: { Dialog, Notify },
    directives: { ClosePopup },
    config: {
      brand: {
        primary: '#244c5a',
        secondary: '#6b5b2a',
        accent: '#7b3f48',
        dark: '#1f2933',
        positive: '#2f7d5c',
        negative: '#a13d45',
        info: '#2f6f8f',
        warning: '#9b6b2d'
      }
    }
  })
  .mount('#app');
