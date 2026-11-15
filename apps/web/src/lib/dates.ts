/** Short calendar date for meeting labels; unknown stays unknown. */
export function shortDate(value: string | null | undefined) {
  if (!value) return 'No date';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'No date'
    : date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year:
          date.getUTCFullYear() === new Date().getUTCFullYear()
            ? undefined
            : 'numeric',
        timeZone: 'UTC',
      });
}
