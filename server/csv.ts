import type { Response } from 'express';

export const csvCell = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return '""';
  const s = String(v);
  // Neutralise spreadsheet formula injection and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Send rows as a CSV download that opens cleanly in Excel (BOM for the ₦ sign and names with accents). */
export function csv(res: Response, filename: string, rows: (string | number | null | undefined)[][]) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.send('﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
}
