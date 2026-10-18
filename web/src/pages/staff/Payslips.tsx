import { Printer } from 'lucide-react';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import type { HotelSettings } from '../../../../shared/constants';
import { Letterhead } from '@/components/app/letterhead';
import { ErrorNote, LoadingRows } from '@/components/app/page';
import { Button } from '@/components/ui/button';
import { naira } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtMonth } from '@/lib/months';

interface Line { id: number; name: string; position: string; bank_name: string | null; account_number: string | null; basic: number; allowances: number; overtime: number; pension: number; paye: number; other_deductions: number; note: string | null; gross: number; net: number }

/** Every payslip for a month, one per printed page. */
export default function Payslips() {
  const { month = '' } = useParams();
  const { data, error } = useApi<{ run: { status: string; lines: Line[] } | null }>(`/payroll?month=${month}`);
  const { data: hotel } = useApi<HotelSettings>('/settings');
  useEffect(() => {
    document.title = `Payslips ${fmtMonth(month)}`;
  }, [month]);
  if (error) return <div className="p-8"><ErrorNote error={error} /></div>;
  if (!data || !hotel) return <LoadingRows />;
  if (!data.run) return <div className="p-8"><ErrorNote error="No pay run for this month" /></div>;
  const row = (label: string, v: number, sign = '') => v ? <div className="flex justify-between py-1"><span>{label}</span><span className="tabular-nums">{sign}{naira(v)}</span></div> : null;
  return (
    <div className="min-h-svh bg-muted/50 px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-2xl items-center justify-between print:hidden">
        <span className="text-sm text-muted-foreground">{data.run.lines.length} payslips · {fmtMonth(month)}{data.run.status === 'draft' ? ' · DRAFT' : ''}</span>
        <Button onClick={() => print()}><Printer /> Print or save as PDF</Button>
      </div>
      {data.run.lines.map((l) => (
        <article key={l.id} className="mx-auto mb-6 max-w-2xl break-after-page rounded-lg border bg-card p-8 text-sm shadow-sm print:mb-0 print:border-0 print:shadow-none">
          <Letterhead hotel={hotel} title={data.run!.status === 'draft' ? 'Payslip (draft)' : 'Payslip'} meta={<div>{fmtMonth(month)}</div>} />
          <dl className="grid grid-cols-2 gap-4 py-5">
            <div><dt className="text-xs text-muted-foreground uppercase">Name</dt><dd className="font-medium">{l.name}</dd><dd className="text-muted-foreground">{l.position}</dd></div>
            <div><dt className="text-xs text-muted-foreground uppercase">Paid into</dt><dd>{l.bank_name ?? '—'}</dd><dd className="font-mono text-muted-foreground">{l.account_number ?? ''}</dd></div>
          </dl>
          <div className="grid gap-8 border-t pt-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Earnings</div>
              {row('Basic pay', l.basic)}
              {row('Allowances', l.allowances)}
              {row('Overtime', l.overtime)}
              <div className="mt-1 flex justify-between border-t pt-1 font-semibold"><span>Gross</span><span className="tabular-nums">{naira(l.gross)}</span></div>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Deductions</div>
              {row('Pension (8%)', l.pension, '−')}
              {row('PAYE (income tax)', l.paye, '−')}
              {row('Other', l.other_deductions, '−')}
              {!l.pension && !l.paye && !l.other_deductions && <div className="py-1 text-muted-foreground">None</div>}
            </div>
          </div>
          <div className="mt-6 flex items-baseline justify-between border-t-2 border-foreground pt-3 text-base font-semibold">
            <span>Take-home pay</span>
            <span className="tabular-nums">{naira(l.net)}</span>
          </div>
          {l.note && <p className="mt-3 text-xs text-muted-foreground">{l.note}</p>}
        </article>
      ))}
    </div>
  );
}
