/* Built-in countdown presets.
 *
 * SCUSD 2026-27 Traditional Student Attendance Calendar (updated 1-13-2026).
 * Every excluded date below was read directly out of the PDF's colour data:
 *   red day-number text  -> weekends + days outside the school year
 *   purple cell fill     -> non-school weekdays (holidays / breaks)
 *   yellow + asterisk    -> first day (Aug 11 2026) / last day (May 27 2027)
 * Cross-checked against the per-month "Days:" totals printed on the calendar:
 *   Aug 15, Sep 21, Oct 21, Nov 15, Dec 14, Jan 18, Feb 18, Mar 17, Apr 22, May 19 = 180
 */

const SCUSD_2026_27 = {
  name: 'Last Day of School',
  subtitle: 'SCUSD 2026–27 · 180 school days',
  emoji: '🎒',
  accent: '#ffb703',
  start: '2026-08-11T08:00',
  target: '2027-05-27T15:00',
  // 0 = Sunday ... 6 = Saturday
  excludeWeekdays: [0, 6],
  units: { years: false, months: false, weeks: false },
  ranges: [
    { start: '2026-06-04', end: '2026-08-10', label: 'Summer break', tag: 'red' },
    { start: '2026-09-07', end: '2026-09-07', label: 'Labor Day', tag: 'purple' },
    { start: '2026-10-12', end: '2026-10-12', label: 'Fall holiday', tag: 'purple' },
    { start: '2026-11-11', end: '2026-11-11', label: 'Veterans Day', tag: 'purple' },
    { start: '2026-11-23', end: '2026-11-27', label: 'Thanksgiving break', tag: 'purple' },
    { start: '2026-12-21', end: '2027-01-01', label: 'Winter break', tag: 'purple' },
    { start: '2027-01-04', end: '2027-01-04', label: 'Winter break (extra day)', tag: 'purple' },
    { start: '2027-01-18', end: '2027-01-18', label: 'MLK Jr. Day', tag: 'purple' },
    { start: '2027-02-08', end: '2027-02-08', label: 'Lincoln Day', tag: 'purple' },
    { start: '2027-02-15', end: '2027-02-15', label: "Presidents' Day", tag: 'purple' },
    { start: '2027-03-22', end: '2027-03-29', label: 'Spring break', tag: 'purple' },
  ],
};
