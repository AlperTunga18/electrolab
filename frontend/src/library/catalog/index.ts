import type { ComponentDef } from '../types';
import { SEMIS } from './semis';
import { PASSIVES } from './passives';
import { ICS } from './ics';
import { MODULES } from './modules';

export const CATALOG: ComponentDef[] = [...SEMIS, ...PASSIVES, ...ICS, ...MODULES];
