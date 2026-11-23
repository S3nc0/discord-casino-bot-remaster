import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/atkinson-hyperlegible/400-italic.css';
import './styles/numerals.css';
import './styles/tokens.css';
import './styles/bundle.css';

export { Surface } from './Surface.tsx';
export type { SurfaceProps } from './Surface.tsx';

export { ThemeProvider, useTheme } from './ThemeProvider.tsx';
export type {
  ReducedMotionPreference,
  ResolvedTheme,
  ThemeContextValue,
  ThemePreference,
  ThemeProviderProps,
} from './ThemeProvider.tsx';

export { CheckIcon, CloseIcon, InfoIcon, WarningIcon } from './icons.tsx';
export type { PixelIconProps } from './icons.tsx';

export { Banner } from './components/Banner.tsx';
export type { BannerProps, BannerVariant } from './components/Banner.tsx';

export { Button } from './components/Button.tsx';
export type { ButtonProps, ButtonVariant } from './components/Button.tsx';

export { Card } from './components/Card.tsx';
export type { CardProps, CardVariant } from './components/Card.tsx';

export { Checkbox, CheckboxGroup } from './components/Checkbox.tsx';
export type { CheckboxGroupProps, CheckboxProps } from './components/Checkbox.tsx';

export { Chip, ChipGroup } from './components/Chip.tsx';
export type { ChipGroupProps, ChipProps } from './components/Chip.tsx';

export { Dialog } from './components/Dialog.tsx';
export type { DialogProps } from './components/Dialog.tsx';

export { FAB } from './components/FAB.tsx';
export type { FABProps, FABVariant } from './components/FAB.tsx';

export { IconButton } from './components/IconButton.tsx';
export type { IconButtonProps, IconButtonVariant } from './components/IconButton.tsx';

export { Avatar, List, ListItem } from './components/List.tsx';
export type { AvatarProps, ListItemProps, ListProps } from './components/List.tsx';

export { NavigationBar } from './components/NavigationBar.tsx';
export type { NavigationBarItem, NavigationBarProps } from './components/NavigationBar.tsx';

export { Progress } from './components/Progress.tsx';
export type { ProgressProps, ProgressVariant } from './components/Progress.tsx';

export { Radio, RadioGroup } from './components/Radio.tsx';
export type { RadioGroupProps, RadioOption, RadioProps } from './components/Radio.tsx';

export { ScrollFade } from './components/ScrollFade.tsx';
export type { ScrollFadeProps } from './components/ScrollFade.tsx';

export { Slider } from './components/Slider.tsx';
export type { SliderProps } from './components/Slider.tsx';

export { Snackbar } from './components/Snackbar.tsx';
export type { SnackbarProps } from './components/Snackbar.tsx';

export { Switch } from './components/Switch.tsx';
export type { SwitchProps } from './components/Switch.tsx';

export { Tabs } from './components/Tabs.tsx';
export type { TabItem, TabsProps } from './components/Tabs.tsx';

export { Tag } from './components/Tag.tsx';
export type { TagHue, TagProps } from './components/Tag.tsx';

export { TextField } from './components/TextField.tsx';
export type { TextFieldProps } from './components/TextField.tsx';

export { buildSamples, getNote, ZZFX_DEFAULT_SAMPLE_RATE } from './audio/zzfx.ts';
export type { ZzfxParams } from './audio/zzfx.ts';

export { getSfxPreset, renderSfxBuffer, SFX_NAMES, SFX_PRESETS } from './audio/sfx.ts';
export type { SfxName } from './audio/sfx.ts';

export {
  AudioManager,
  clampVolume,
  computeMusicGain,
  computeSfxGain,
  DEFAULT_SOUND_SETTINGS,
  DEFAULT_SOUND_VOLUME,
  getDefaultAudioManager,
  volumeToGain,
} from './audio/AudioManager.ts';
export type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioManagerOptions,
  AudioNodeLike,
  AudioParamLike,
  AudioSnapshot,
  GainNodeLike,
  MusicTrack,
  PlaySfxOptions,
  SoundSettings,
} from './audio/AudioManager.ts';

export { AudioProvider, useSfx } from './audio/useSfx.tsx';
export type { AudioProviderProps, UseSfxResult } from './audio/useSfx.tsx';

export { isReducedMotionActive } from './fx/motion.ts';
export type { ReducedMotionFallback } from './fx/motion.ts';

export {
  COIN_ROLE_VARS,
  CONFETTI_ROLE_VARS,
  resolveCssRoleColor,
  resolveRolePalette,
} from './fx/palette.ts';

export {
  DEFAULT_COIN_BURST_COUNT,
  DEFAULT_CONFETTI_COUNT,
  MAX_FX_PARTICLES_DESKTOP,
  MAX_FX_PARTICLES_MOBILE,
  MOBILE_BREAKPOINT_PX,
  resolveParticleCount,
  triggerCoinBurst,
  triggerConfetti,
  triggerStaticFlash,
} from './fx/confetti.ts';
export type {
  BurstOptions,
  CoinBurstOptions,
  ConfettiOptions,
  FlashOptions,
  FxParticleKind,
} from './fx/confetti.ts';

export { triggerScreenShake } from './fx/shake.ts';
export type { ScreenShakeOptions } from './fx/shake.ts';

export { useFx } from './fx/useFx.ts';
export type { UseFxOptions, UseFxResult } from './fx/useFx.ts';

export {
  GAME_ICON_NAMES,
  GAME_ICON_ROWS,
  GameIcon,
  rowsToPaths,
  SKYLINE_COLUMNS,
  SKYLINE_ROWS,
  Skyline,
  Sparkle,
} from './pixel/index.ts';
export type { GameIconName, GameIconProps, SkylineProps, SparkleProps } from './pixel/index.ts';
export {
  PixelScene,
  PixelTile,
  SceneLayer,
  scenePaths,
  useSceneFrame,
  useSceneOnce,
} from './pixel/index.ts';
export type { SceneOnceOptions } from './pixel/index.ts';
export type { PixelSceneProps, PixelTileProps, SceneArt, SceneLayerProps } from './pixel/index.ts';
