import { Type } from 'typebox';
import { LOCALES } from '../i18n/locale.ts';

export const LocaleSchema = Type.Enum(LOCALES);
