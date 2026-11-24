import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export interface AccentPreset {
  id: string;
  name: string;
  hex: string;
}

export interface ChartPalettePreset {
  id: string;
  name: string;
  colors: string[];
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'indigo', name: 'Indigo', hex: '#4F46E5' },
  { id: 'blue', name: 'Electric Blue', hex: '#2563EB' },
  { id: 'violet', name: 'Violet', hex: '#7C3AED' },
  { id: 'emerald', name: 'Emerald', hex: '#059669' },
  { id: 'rose', name: 'Crimson Rose', hex: '#E11D48' },
  { id: 'amber', name: 'Amber Gold', hex: '#D97706' },
  { id: 'teal', name: 'Deep Teal', hex: '#0D9488' },
];

export const CHART_PALETTE_PRESETS: ChartPalettePreset[] = [
  {
    id: 'indigo_cobalt',
    name: 'Indigo & Cobalt',
    colors: ['#4F46E5', '#2563EB', '#7C3AED', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899'],
  },
  {
    id: 'oceanic',
    name: 'Oceanic Teal',
    colors: ['#0D9488', '#0284C7', '#2563EB', '#38BDF8', '#14B8A6', '#6366F1', '#8B5CF6'],
  },
  {
    id: 'executive_slate',
    name: 'Executive Slate & Gold',
    colors: ['#1E293B', '#D97706', '#0F766E', '#2563EB', '#475569', '#B45309', '#64748B'],
  },
  {
    id: 'coral_violet',
    name: 'Coral & Violet',
    colors: ['#7C3AED', '#EC4899', '#F43F5E', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'],
  },
  {
    id: 'forest_sage',
    name: 'Forest & Sage',
    colors: ['#059669', '#10B981', '#0D9488', '#84CC16', '#0284C7', '#65A30D', '#14B8A6'],
  },
  {
    id: 'okabe_ito',
    name: 'Colorblind-Safe (Okabe-Ito)',
    colors: ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442'],
  },
];

export function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return [79, 70, 229];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

interface ThemeContextValue {
  accentHex: string;
  setAccentHex: (hex: string) => void;
  chartPaletteId: string;
  chartColors: string[];
  setChartPaletteId: (id: string) => void;
  setCustomChartColors: (colors: string[]) => void;
  resetColors: () => void;
}

const ThemeCustomizationContext = createContext<ThemeContextValue>({
  accentHex: ACCENT_PRESETS[0].hex,
  setAccentHex: () => {},
  chartPaletteId: CHART_PALETTE_PRESETS[0].id,
  chartColors: CHART_PALETTE_PRESETS[0].colors,
  setChartPaletteId: () => {},
  setCustomChartColors: () => {},
  resetColors: () => {},
});

const THEME_STORAGE_KEY = 'datamind_theme_customization_v1';

interface StoredThemePrefs {
  accentHex?: string;
  chartPaletteId?: string;
  customColors?: string[] | null;
}

function loadThemePrefs(): StoredThemePrefs {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as StoredThemePrefs;
  } catch {
    return {};
  }
}

export const ThemeCustomizationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = useMemo(() => loadThemePrefs(), []);
  const [accentHex, setAccentHex] = useState<string>(initial.accentHex || ACCENT_PRESETS[0].hex);
  const [chartPaletteId, setChartPaletteIdState] = useState<string>(initial.chartPaletteId || CHART_PALETTE_PRESETS[0].id);
  const [customColors, setCustomColors] = useState<string[] | null>(initial.customColors ?? null);

  const chartColors = useMemo(() => {
    if (chartPaletteId === 'custom' && customColors && customColors.length > 0) {
      return customColors;
    }
    return CHART_PALETTE_PRESETS.find((p) => p.id === chartPaletteId)?.colors || CHART_PALETTE_PRESETS[0].colors;
  }, [chartPaletteId, customColors]);

  useEffect(() => {
    const [r, g, b] = hexToRgbTuple(accentHex);
    const root = document.documentElement;
    root.style.setProperty('--dm-accent', accentHex);
    root.style.setProperty('--dm-accent-rgb', `${r}, ${g}, ${b}`);
  }, [accentHex]);

  useEffect(() => {
    try {
      localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ accentHex, chartPaletteId, customColors })
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [accentHex, chartPaletteId, customColors]);

  const setChartPaletteId = (id: string) => {
    setChartPaletteIdState(id);
    if (id !== 'custom') setCustomColors(null);
  };

  const setCustomChartColors = (colors: string[]) => {
    setChartPaletteIdState('custom');
    setCustomColors(colors);
  };

  const resetColors = () => {
    setAccentHex(ACCENT_PRESETS[0].hex);
    setChartPaletteIdState(CHART_PALETTE_PRESETS[0].id);
    setCustomColors(null);
  };

  return (
    <ThemeCustomizationContext.Provider
      value={{
        accentHex,
        setAccentHex,
        chartPaletteId,
        chartColors,
        setChartPaletteId,
        setCustomChartColors,
        resetColors,
      }}
    >
      {children}
    </ThemeCustomizationContext.Provider>
  );
};

export function useThemeCustomization() {
  return useContext(ThemeCustomizationContext);
}
