export function load() {
  return { readOnly: process.env.READ_ONLY_MODE === '1' };
}
