/** What the home screen's one button says: computed here, as data, so the
 *  screen draws it and decides nothing (CLAUDE.md, "What a screen shows is
 *  computed once, as data, in lib").
 */

/** The Study button's text. "Carry on" once anything has been answered
 *  today — the queue is not kept, so there is no count of what is left of
 *  it, only what is due. Grammar exercises owed are named beside the due
 *  cards, and on their own when no card is due: a sitting with only a table
 *  in it is still a sitting. */
export function studyLine({ due, allowance, carryOn, drills = 0 }: {
  /** Cards due now. */
  due: number;
  /** New words the day has room for. */
  allowance: number;
  /** Something was answered today. */
  carryOn: boolean;
  /** Grammar exercises owed (grammar/derive.ts `dueRules`, over the
   *  committed rules with a generator). */
  drills?: number;
}): string {
  const verb = carryOn ? 'Carry on' : 'Study';
  const parts: string[] = [];
  if (due > 0) parts.push(`${due} due card${due === 1 ? '' : 's'}`);
  if (drills > 0) parts.push(`${drills} grammar exercise${drills === 1 ? '' : 's'}`);
  if (parts.length) return `${verb}: ${parts.join(' · ')}`;
  if (allowance > 0) return `${carryOn ? 'Carry on' : 'Start'}: ${allowance} new words`;
  return verb;
}
