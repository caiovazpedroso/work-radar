/**
 * work-radar — per-user locale config (work week + holiday region).
 * Lives outside the skill dir so installs/upgrades don't overwrite it.
 */

import fs from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULT_USER_CONFIG = join(homedir(), '.claude', 'cache', 'work-radar-user.json');

const DEFAULTS = {
  work_week: 'mon_fri',
  holiday_region: 'latam',
};

export function loadUserConfig(configPath) {
  const path = configPath || DEFAULT_USER_CONFIG;
  if (!fs.existsSync(path)) return { ...DEFAULTS, config_path: path, using_defaults: true };
  try {
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
    return {
      ...DEFAULTS,
      ...parsed,
      config_path: path,
      using_defaults: false,
    };
  } catch {
    return { ...DEFAULTS, config_path: path, using_defaults: true, config_error: 'parse failed' };
  }
}
