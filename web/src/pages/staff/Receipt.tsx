import { Printer } from 'lucide-react';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CHARGE_LABELS, type ChargeMethod, type HotelSettings } from '../../../../shared/constants';
import { Letterhead } from '@/components/app/letterhead';
import { ErrorNote, LoadingRows } from '@/components/app/page';
import { Button } from '@/components/ui/button';
import { fmtDateTime, naira } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Sale {
  id: number;
  receipt_no: string;
  created_at: string;
  method: ChargeMethod;
  total: number;
  staff: string | null;
  room_number: string | null;
  guest_name: string | null;
  items: { name: string; qty: number; unit_price: number }[];
}

/** A bar & shop receipt sized for an 80 mm receipt printer; prints just as well on A4. */
export default function Receipt() {
  const { id } = useParams();
  const { data: s, error } = useApi<Sale>(`/sales/${Number(id)}`);
  const { data: hotel } = useApi<HotelSettings>('/settings');
  useEffect(() => {
    if (s) document.title = `Receipt ${s.receipt_no}`;
  }, [s]);
  if (error) return <div className="p-8"><ErrorNote error={error} /></div>;
  if (!s || !hotel) return <LoadingRows />;
  const room = s.method === 'room';

  return (
    <div className="min-h-svh bg-muted/50 px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-xs items-center justify-between print:hidden">
        <span className="text-sm text-muted-foreground">{s.receipt_no}</span>
        <Button onClick={() => print()}><Printer /> Print</Button>
      </div>
      <article className="mx-auto max-w-xs rounded-lg border bg-card p-6 font-mono text-[13px] shadow-sm print:max-w-[72mm] print:border-0 print:p-0 print:shadow-none">
        <Letterhead hotel={hotel} compact title={room ? 'Room charge' : 'Receipt'} meta={<>{s.receipt_no} · {fmtDateTime(s.created_at)}</>} />
        <table className="my-4 w-full">
          <tbody>
            {s.items.map((i, n) => (
              <tr key={n} className="align-top">
                <td className="py-1 pr-2">
                  {i.name}
                  <div className="text-[11px] text-muted-foreground">{i.qty} × {naira(i.unit_price)}</div>
                </td>
                <td className="py-1 text-right tabular-nums">{naira(i.qty * i.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-between border-t border-dashed pt-3 text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{naira(s.total)}</span>
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{room ? `Added to room ${s.room_number} bill` : `Paid by ${CHARGE_LABELS[s.method]}`}</span>
          {s.staff && <span>Served by {s.staff.split(' ')[0]}</span>}
        </div>
        {room && s.guest_name && <div className="mt-1 text-xs text-muted-foreground">Guest: {s.guest_name}</div>}
        <footer className="mt-5 border-t border-dashed pt-4 text-center text-[11px] text-muted-foreground">
          {hotel.invoice_note || 'Thank you.'}
          {hotel.tagline && <div className="mt-1 italic">{hotel.tagline}</div>}
        </footer>
      </article>
    </div>
  );
}
