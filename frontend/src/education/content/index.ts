import type { Lesson } from '../types';
import { TEMEL } from './temel';
import { ANALOG } from './analog';
import { DIJITAL } from './dijital';
import { GUC } from './guc';

export const LESSONS: Lesson[] = [...TEMEL, ...ANALOG, ...DIJITAL, ...GUC];
