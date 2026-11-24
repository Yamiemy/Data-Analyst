import React, { useEffect, useState } from 'react';
import { Check, CheckCircle2, Moon, Palette, RotateCcw, ShieldCheck, Sun } from 'lucide-react';
import { ACCENT_PRESETS, CHART_PALETTE_PRESETS, useThemeCustomization } from '../context/ThemeContext';
import { checkServerHealth } from '../services/aiService';

interface SettingsViewProps {
  workspaceName: string;
  onChangeWorkspaceName: (name: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  workspaceName,
  onChangeWorkspaceName,
  theme,
  onToggleTheme,
}) => {
  const {
    accentHex,
    setAccentHex,
    chartPaletteId,
    chartColors,
    setChartPaletteId,
    setCustomChartColors,
    resetColors,
  } = useThemeCustomization();

  const [nameInput, setNameInput] = useState(workspaceName);
  const [savedNotice, setSavedNotice] = useState(false);
  const [geminiReady, setGeminiReady] = useState<boolean | null>(null);

  useEffect(() => {
    void checkServerHealth().then((res) => setGeminiReady(res.geminiConfigured));
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim()) {
      onChangeWorkspaceName(nameInput.trim());
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 1800);
    }
  };

  const handleSlotColorChange = (index: number, hex: string) => {
    const next = [...chartColors];
    next[index] = hex;
    setCustomChartColors(next);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Workspace Preferences
        </h3>
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Workspace Name
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="submit"
                style={{ backgroundColor: accentHex }}
                className="rounded-lg px-4 py-2 text-xs font-semibold text-white hover:opacity-90 whitespace-nowrap shrink-0"
              >
                Save Name
              </button>
            </div>
            {savedNotice && (
              <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Workspace name updated.
              </p>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4" style={{ color: accentHex }} />
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Appearance &amp; Colour Customization
            </h3>
          </div>
          <button
            type="button"
            onClick={resetColors}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Colours
          </button>
        </div>

        {/* Light / Dark Mode */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-5 dark:border-slate-800">
          <div>
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200">Color Theme</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Switch between crisp light canvas and dark slate mode
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleTheme}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 whitespace-nowrap shrink-0"
          >
            {theme === 'light' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            {theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          </button>
        </div>

        {/* Workspace Accent Colour */}
        <div className="space-y-3 border-b border-slate-100 pb-5 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-200">Workspace &amp; PDF Accent Colour</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Applies across primary buttons, active navigation, and exported PDF headers
              </div>
            </div>
            <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{accentHex.toUpperCase()}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {ACCENT_PRESETS.map((preset) => {
              const selected = accentHex.toUpperCase() === preset.hex.toUpperCase();
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setAccentHex(preset.hex)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selected
                      ? 'border-slate-900 bg-slate-50 text-slate-900 dark:border-white dark:bg-slate-800 dark:text-white'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span
                    style={{ backgroundColor: preset.hex }}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-white"
                  >
                    {selected && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span>{preset.name}</span>
                </button>
              );
            })}

            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 cursor-pointer hover:border-slate-300 dark:border-slate-700 dark:text-slate-200">
              <input
                type="color"
                value={accentHex}
                onChange={(e) => setAccentHex(e.target.value)}
                aria-label="Custom workspace accent color"
                className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0"
              />
              <span>Custom Hex</span>
            </label>
          </div>
        </div>

        {/* Chart Colour Palette */}
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200">Data Visualization Colour Palette</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Choose a curated multi-series palette or fine-tune individual series hex colors
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {CHART_PALETTE_PRESETS.map((preset) => {
              const selected = chartPaletteId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setChartPaletteId(preset.id)}
                  className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors ${
                    selected
                      ? 'border-slate-900 bg-slate-50 dark:border-white dark:bg-slate-800/80'
                      : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{preset.name}</div>
                    <div className="mt-1.5 flex items-center gap-1">
                      {preset.colors.map((c, idx) => (
                        <span
                          key={idx}
                          style={{ backgroundColor: c }}
                          className="h-3.5 w-4 rounded-xs border border-black/10 dark:border-white/10"
                        />
                      ))}
                    </div>
                  </div>
                  {selected && <Check className="h-4 w-4 shrink-0 text-slate-900 dark:text-white" />}
                </button>
              );
            })}
          </div>

          {/* Individual Series Hex Customizer */}
          <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
              <span>Customize Individual Series Colours</span>
              {chartPaletteId === 'custom' && (
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">Custom active</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {chartColors.slice(0, 7).map((hex, idx) => (
                <label
                  key={idx}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-mono text-slate-600 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <input
                    type="color"
                    value={hex}
                    onChange={(e) => handleSlotColorChange(idx, e.target.value)}
                    aria-label={`Series ${idx + 1} color`}
                    className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
                  />
                  <span>S{idx + 1}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" style={{ color: accentHex }} />
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Computation &amp; Privacy Architecture
          </h3>
        </div>
        <ul className="mt-3 space-y-2 text-xs text-slate-600 dark:text-slate-300 list-disc pl-5">
          <li>
            Raw dataset rows remain in your local browser session and are processed deterministically for EDA, SQL, Cleaning, and Predictive ML.
          </li>
          <li>
            Only compact schemas, column profiles, and computed summary outputs are sent to the server-side AI endpoint.
          </li>
          <li>
            Server-side AI capability:{' '}
            <span className="font-semibold text-slate-900 dark:text-white">
              {geminiReady === null ? 'Checking...' : geminiReady ? 'Configured and ready' : 'Awaiting GEMINI_API_KEY in Settings > Secrets'}
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
};
