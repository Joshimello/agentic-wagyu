import type { AccessRole } from '../lib/server/access';

export function load({ locals }: { locals: { access?: AccessRole } }) {
  return {
    readOnly: process.env.READ_ONLY_MODE === '1',
    access: locals.access ?? 'open',
  };
}
