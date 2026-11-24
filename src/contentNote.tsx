/* Shows what the check of a project found. */
import React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useContentMarks } from './contentMarks';
import { t } from './i18n';
import type { ContentCheck, Reason } from './services/contentCheck';

const reasonText = (reason: Reason): string => ({
  marked: t('marked by its author'), sexual: t('sexual content'), violence: t('violence'), drugs: t('drugs'),
  gambling: t('gambling'), selfharm: t('self-harm'), password: t('asks for a password'), ai: t('opinion of the local AI'),
})[reason];

/** Small mark for covers and lists. */
export function RatingBadge({ check }: { check?: ContentCheck }) {
  const { on } = useContentMarks();
  if (!on || !check || check.rating === 'ok' || check.confirmed) return null;
  return <span className={`rating-badge r${check.rating}`} title={t('May not be for children')}>{check.rating}+</span>;
}

export function ContentNote({ check, children }: { check: ContentCheck; children?: React.ReactNode }) {
  const { on } = useContentMarks();
  if (!on) return null;
  const fine = check.rating === 'ok' || check.confirmed;
  const reasons = check.reasons.map(reasonText).join(', ');
  return <div className={`content-note ${fine ? check.reasons.includes('password') ? 'watch' : '' : `r${check.rating}`}`} role={fine ? undefined : 'note'}>
    {fine ? <ShieldCheck size={18}/> : <ShieldAlert size={18}/>}
    <div>
      <b>{check.confirmed && check.rating !== 'ok' ? t('Marked as fine by you') : check.rating === '18' ? t('May be for adults only (18+)') : check.rating === '16' ? t('May be from 16 years (16+)') : t('Nothing unusual found')}</b>
      <small>{[reasons, check.by === 'ai' ? t('Checked by rules and by the local AI on this device') : t('Checked automatically on this device'), t('Pictures are not checked, and the check can be wrong.')].filter(Boolean).join(' · ')}</small>
      {children}
    </div>
  </div>;
}
