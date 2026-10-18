import { Printer } from 'lucide-react';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ALL_PAYMENT_LABELS, type HotelSettings } from '../../../../shared/constants';
import { Letterhead } from '@/components/app/letterhead';
import { ErrorNote, LoadingRows } from '@/components/app/page';
import { Button } from '@/components/ui/button';
import { fmtDate, fmtDateLong, naira, todayISO } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { balanceOf, chargedOf, type Reservation } from './desk/ReservationSheet';

/** Print-ready folio. Opens in its own tab; the browser's print gives a clean A4 or PDF. */
export default function Invoice() {
  const { id } = useParams();
  const { data: r, error } = useApi<Reservation>(`/reservations/${Number(id)}`);
  const { data: hotel } = useApi<HotelSettings>('/settings');
  useEffect(() => {
    if (r) document.title = `Invoice ${r.code} — ${r.guest_name}`;
  }, [r]);
  if (error) return <div className="p-8"><ErrorNote error={error} /></div>;
  if (!r || !hotel) return <LoadingRows />;
  const balance = balanceOf(r);
  const settled = (r.status === 'checked_out' || r.status === 'cancelled') && balance <= 0;
  // A cancelled booking is billed only for the deposit the hotel kept, never for nights it didn't use.
  const lines =
    r.status === 'cancelled'
      ? r.retained > 0 ? [{ date: r.cancelled_on ?? r.check_in, kind: 'fee', description: 'Cancellation fee (deposit kept)', amount: r.retained }] : []
      : r.folio ?? [];

  return (
    <div className="min-h-svh bg-muted/50 px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between print:hidden">
        <span className="text-sm text-muted-foreground">Bill for {r.guest_name}</span>
        <Button onClick={() => print()}><Printer /> Print or save as PDF</Button>
      </div>
      <article className="mx-auto max-w-3xl rounded-lg border bg-card p-10 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <Letterhead
          hotel={hotel}
          title={settled ? 'Receipt' : 'Invoice'}
          meta={
            <>
              <div className="font-mono">{r.code}</div>
              <div>{fmtDateLong(todayISO())}</div>
            </>
          }
        />

        <dl className="grid grid-cols-2 gap-4 py-6 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground uppercase">Guest</dt><dd className="font-medium">{r.guest_name}</dd><dd className="text-muted-foreground">{r.guest_phone}</dd></div>
          {r.company_name && <div><dt className="text-xs text-muted-foreground uppercase">Company</dt><dd className="font-medium">{r.company_name}</dd></div>}
          <div><dt className="text-xs text-muted-foreground uppercase">Stay</dt><dd>{fmtDate(r.check_in)} → {fmtDate(r.check_out)}</dd><dd className="text-muted-foreground">{r.nights} night{r.nights > 1 ? 's' : ''}</dd></div>
          <div><dt className="text-xs text-muted-foreground uppercase">Room</dt><dd>{r.room_number ? `Room ${r.room_number}` : '—'}</dd><dd className="text-muted-foreground">{r.room_type}</dd></div>
        </dl>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-y text-left text-xs text-muted-foreground uppercase">
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Amount (₦)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-dashed">
                <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground tabular-nums">{fmtDate(l.date)}</td>
                <td className="py-2">{l.kind === 'room' ? `Accommodation — ${l.description}` : l.description}</td>
                <td className="py-2 text-right tabular-nums">{naira(l.amount)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td />
              <td className="py-2.5">Total charges</td>
              <td className="py-2.5 text-right tabular-nums">{naira(chargedOf(r))}</td>
            </tr>
            {r.payments?.map((p) => (
              <tr key={p.id} className="text-success">
                <td className="py-1.5 pr-4 tabular-nums">{fmtDate(p.date)}</td>
                <td className="py-1.5">{ALL_PAYMENT_LABELS[p.method] ?? p.method}</td>
                <td className="py-1.5 text-right tabular-nums">−{naira(p.amount)}</td>
              </tr>
            ))}
            {r.refunds?.map((x) => (
              <tr key={`r${x.id}`}>
                <td className="py-1.5 pr-4 text-muted-foreground tabular-nums">{fmtDate(x.date)}</td>
                <td className="py-1.5">Refunded ({ALL_PAYMENT_LABELS[x.method] ?? x.method})</td>
                <td className="py-1.5 text-right tabular-nums">+{naira(x.amount)}</td>
              </tr>
            ))}
            {r.taxes?.map((t) => (
              <tr key={t.name} className="text-xs text-muted-foreground">
                <td />
                <td className="py-1">Includes {t.name} at {t.rate}% on {naira(t.base)}</td>
                <td className="py-1 text-right tabular-nums">{naira(t.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-foreground text-base font-semibold">
              <td />
              <td className="py-3">{balance < 0 ? 'Credit due to guest' : 'Balance due'}</td>
              <td className="py-3 text-right tabular-nums">{naira(Math.abs(balance))}</td>
            </tr>
          </tbody>
        </table>

        <footer className="mt-10 flex flex-wrap justify-between gap-6 text-xs text-muted-foreground">
          <div className="max-w-sm space-y-1">
            <p>{hotel.invoice_note}</p>
            {hotel.tax_id && <p>Tax ID (TIN): {hotel.tax_id}</p>}
            {hotel.bank_details && balance > 0 && <p><b className="text-foreground">Pay by transfer:</b> {hotel.bank_details}</p>}
            {hotel.tagline && <p className="italic">{hotel.tagline}</p>}
          </div>
          <div className="text-right">
            Guest signature
            <div className="mt-6 w-52 border-b border-foreground/40" />
          </div>
        </footer>
      </article>
    </div>
  );
}
