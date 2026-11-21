import { useId } from 'react';
import { useT } from './i18n.ts';
import { useSettingsStore, type LanguageSetting, type ThemeSetting } from './stores/settings.ts';

const LANGUAGES: readonly LanguageSetting[] = ['auto', 'en', 'ja'];
const THEMES: readonly ThemeSetting[] = ['auto', 'light', 'dark'];

export function SettingsScreen() {
  const t = useT();
  const id = useId();
  const { language, theme, sound, animations, update } = useSettingsStore();
  return (
    <form
      className="panel settings"
      aria-labelledby={`${id}-title`}
      onSubmit={(e) => e.preventDefault()}
    >
      <h1 id={`${id}-title`}>{t('settings.title')}</h1>

      <div className="field">
        <label htmlFor={`${id}-lang`}>{t('settings.language')}</label>
        <select
          id={`${id}-lang`}
          value={language}
          onChange={(e) => update({ language: e.target.value as LanguageSetting })}
        >
          {LANGUAGES.map((value) => (
            <option key={value} value={value}>
              {t(`settings.language.${value}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${id}-theme`}>{t('settings.theme')}</label>
        <select
          id={`${id}-theme`}
          value={theme}
          onChange={(e) => update({ theme: e.target.value as ThemeSetting })}
        >
          {THEMES.map((value) => (
            <option key={value} value={value}>
              {t(`settings.theme.${value}`)}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="field">
        <legend>{t('settings.sound')}</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={sound.enabled}
            onChange={(e) => update({ sound: { enabled: e.target.checked } })}
          />
          {t('settings.sound.enabled')}
        </label>
        <label htmlFor={`${id}-sfx`}>{t('settings.sound.sfx')}</label>
        <input
          id={`${id}-sfx`}
          type="range"
          min={0}
          max={100}
          value={sound.sfx}
          disabled={!sound.enabled}
          onChange={(e) => update({ sound: { sfx: Number(e.target.value) } })}
        />
        <label htmlFor={`${id}-music`}>{t('settings.sound.music')}</label>
        <input
          id={`${id}-music`}
          type="range"
          min={0}
          max={100}
          value={sound.music}
          disabled={!sound.enabled}
          onChange={(e) => update({ sound: { music: Number(e.target.value) } })}
        />
      </fieldset>

      <label className="check">
        <input
          type="checkbox"
          checked={animations}
          onChange={(e) => update({ animations: e.target.checked })}
        />
        {t('settings.motion')}
      </label>
    </form>
  );
}
