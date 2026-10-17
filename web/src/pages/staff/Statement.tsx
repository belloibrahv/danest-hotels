import { Printer } from 'lucide-react';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import type { HotelSettings } from '../../../../shared/constants';
import { Letterhead } from '@/components/app/letterhead';
import { ErrorNote, LoadingRows } from '@/components/app/page';
import { Button } from '@/components/ui/button';
import { fmtDate, fmtDateLong, naira, todayISO } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ledgerOf, type CompanyStatement } from './Companies';

/** A company's account statement on the hotel letterhead, ready to print or save as PDF and send. */
export default function Statement() {
  const { id } = useParams();
  const { data: s, error } = useApi<CompanyStatement>(`/companies/${Number(id)}`);
  const { data: hotel } = useApi<HotelSettings>('/settings');
  useEffect(() => {
    if (s) document.title = `Statement — ${s.name}`;
  }, [s]);
  if (error) return <div className="p-8"><ErrorNote error={error} /></div>;
  if (!s || !hotel) return <LoadingRows />;
  const rows = ledgerOf(s);

  return (
    <div className="min-h-svh bg-muted/50 px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between print:hidden">
        <span className="text-sm text-muted-foreground">Statement for {s.name}</span>
        <Button onClick={() => print()}><Printer /> Print or save as PDF</Button>
      </div>
      <article className="mx-auto max-w-3xl rounded-lg border bg-card p-10 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <Letterhead hotel={hotel} title="Statement of account" meta={<div>{fmtDateLong(todayISO())}</div>} />

        <dl className="grid grid-cols-2 gap-4 py-6 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground uppercase">Account</dt>
            <dd className="font-medium">{s.name}</dd>
            {s.contact_name && <dd className="text-muted-foreground">Attn: {s.contact_name}</dd>}
            {s.address && <dd className="text-muted-foreground">{s.address}</dd>}
          </div>
          <div>
            <dt className="text-xs text-muted-foreground uppercase">Terms</dt>
            <dd>{s.discount_pct ? `${s.discount_pct}% negotiated discount` : 'Standard rates'}</dd>
            <dd className="text-muted-foreground">{s.credit_limit ? `Credit limit ${naira(s.credit_limit)}` : 'No credit limit'}</dd>
          </div>
          <div className="sm:text-right">
            <dt className="text-xs text-muted-foreground uppercase">Balance owed</dt>
            <dd className="text-2xl font-semibold tabular-nums">{naira(s.balance)}</dd>
          </div>
        </dl>

        {rows.length === 0 ? (
          <p className="border-t py-8 text-center text-sm text-muted-foreground">Nothing has been billed to this account yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y text-left text-xs text-muted-foreground uppercase">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Detail</th>
                <th className="py-2 text-right font-medium">Charged</th>
                <th className="py-2 text-right font-medium">Paid</th>
                <th className="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-dashed">
                  <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground tabular-nums">{fmtDate(r.date)}</td>
                  <td className="py-2 pr-4">{r.text}</td>
                  <td className="py-2 text-right tabular-nums">{r.debit ? naira(r.debit) : ''}</td>
                  <td className="py-2 text-right text-success tabular-nums">{r.credit ? naira(r.credit) : ''}</td>
                  <td className="py-2 text-right tabular-nums">{naira(r.running)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-foreground text-base font-semibold">
                <td colSpan={4} className="py-3">Balance owed</td>
                <td className="py-3 text-right tabular-nums">{naira(s.balance)}</td>
              </tr>
            </tbody>
          </table>
        )}

        <footer className="mt-10 space-y-1 text-xs text-muted-foreground">
          {hotel.bank_details && s.balance > 0 && <p><b className="text-foreground">Pay by transfer:</b> {hotel.bank_details}</p>}
          <p>Please quote your company name with every payment.</p>
          {hotel.tagline && <p className="italic">{hotel.tagline}</p>}
        </footer>
      </article>
    </div>
  );
}
