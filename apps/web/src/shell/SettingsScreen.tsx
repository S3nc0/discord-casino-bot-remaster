import { useId } from 'react';
import {
  LANGUAGE_SETTINGS,
  MOTION_SETTINGS,
  THEME_SETTINGS,
  type LanguageSetting,
  type MotionSetting,
  type ThemeSetting,
} from '@casino/shared';
import { RadioGroup, Slider, Surface, Switch } from '@casino/ui';
import { useT } from './i18n.ts';
import { useSettingsStore } from './stores/settings.ts';

/** Every control writes to the store at once; `SettingsSync` saves it through the API. */
export function SettingsScreen() {
  const t = useT();
  const id = useId();
  const { language, theme, sound, motion, update } = useSettingsStore();
  const percent = (value: number) => `${value}%`;
  return (
    <Surface label={t('settings.title')}>
      <form className="settings" onSubmit={(e) => e.preventDefault()}>
        <h1>{t('settings.title')}</h1>

        <RadioGroup
          legend={t('settings.language')}
          name={`${id}-language`}
          value={language}
          onChange={(value) => update({ language: value as LanguageSetting })}
          options={LANGUAGE_SETTINGS.map((value) => ({
            value,
            label: t(`settings.language.${value}`),
          }))}
        />

        <RadioGroup
          legend={t('settings.theme')}
          name={`${id}-theme`}
          value={theme}
          onChange={(value) => update({ theme: value as ThemeSetting })}
          options={THEME_SETTINGS.map((value) => ({ value, label: t(`settings.theme.${value}`) }))}
        />

        <fieldset className="settings__group">
          <legend>{t('settings.sound')}</legend>
          <Switch
            label={t('settings.sound.enabled')}
            checked={sound.enabled}
            onChange={(enabled) => update({ sound: { enabled } })}
          />
          <Slider
            label={t('settings.sound.sfx')}
            value={sound.sfxVolume}
            min={0}
            max={100}
            disabled={!sound.enabled}
            formatValue={percent}
            onChange={(sfxVolume) => update({ sound: { sfxVolume } })}
          />
          <Slider
            label={t('settings.sound.music')}
            value={sound.musicVolume}
            min={0}
            max={100}
            disabled={!sound.enabled}
            formatValue={percent}
            onChange={(musicVolume) => update({ sound: { musicVolume } })}
          />
        </fieldset>

        <RadioGroup
          legend={t('settings.motion')}
          name={`${id}-motion`}
          value={motion}
          onChange={(value) => update({ motion: value as MotionSetting })}
          options={MOTION_SETTINGS.map((value) => ({
            value,
            label: t(`settings.motion.${value}`),
          }))}
        />
      </form>
    </Surface>
  );
}
