import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {DatasetProvider} from './context/DatasetContext.tsx';
import {ThemeCustomizationProvider} from './context/ThemeContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ThemeCustomizationProvider>
    <DatasetProvider>
      <App />
    </DatasetProvider>
  </ThemeCustomizationProvider>
);
