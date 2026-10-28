import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { setCodeEditorAdapter } from './features/coding/editor/CodeEditorAdapter';
import { monacoEditorAdapter } from './features/coding/editor/MonacoEditor';
import './styles/index.css';

setCodeEditorAdapter(monacoEditorAdapter);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
