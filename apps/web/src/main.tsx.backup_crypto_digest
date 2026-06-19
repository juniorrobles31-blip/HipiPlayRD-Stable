import { enableGlobalScroll } from './enableGlobalScroll';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { registerServiceWorker } from './registerServiceWorker';
import { initMobileDb, migrateLegacyLocalUserToIndexedDb } from './hipiplayDb';
import { enableAppScroll } from './enableAppScroll';

enableGlobalScroll();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

registerServiceWorker();

initMobileDb()
  .then(() => migrateLegacyLocalUserToIndexedDb())
  .then(() => console.log('HipiPlay IndexedDB lista.'))
  .catch((error) => console.error('Error inicializando IndexedDB:', error));
enableAppScroll();




