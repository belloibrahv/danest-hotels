import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api, naira } from '@/lib/api';
import { SitePage } from './site';

/** Paystack sends the guest back here. We ask the server to verify with Paystack before showing anything. */
export default function BookingPaid() {
  const [params] = useSearchParams();
  const reference = params.get('reference') ?? params.get('trxref') ?? '';
  const [state, setState] = useState<{ status: string; amount?: number; code?: string; booking_status?: string } | { error: string } | null>(null);

  useEffect(() => {
    if (!reference) return setState({ error: 'Missing payment reference.' });
    api<{ status: string; amount?: number; code?: string; booking_status?: string }>(`/public/payments/verify?reference=${encodeURIComponent(reference)}`).then(setState, (e) => setState({ error: e.message }));
  }, [reference]);

  const ok = state && 'status' in state && state.status === 'success';
  return (
    <SitePage>
      <div className="mx-auto max-w-md px-4 py-20">
        <Card className="gap-0 py-0 text-center shadow-sm">
          <CardContent className="p-8">
            {!state ? (
              <>
                <Loader2 className="mx-auto size-10 animate-spin text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">Confirming your payment with Paystack…</p>
              </>
            ) : ok ? (
              <>
                <CheckCircle2 className="mx-auto size-12 text-success" />
                <h1 className="mt-4 text-xl font-semibold">Payment received</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {naira((state as { amount: number }).amount)} paid. Your booking <span className="font-mono font-medium text-foreground">{(state as { code: string }).code}</span>{' '}
                  {(state as { booking_status?: string }).booking_status === 'pending'
                    ? 'is waiting for the front desk to confirm a room. We will contact you shortly.'
                    : 'is confirmed.'}
                </p>
                <Button className="mt-6" asChild><Link to={`/booking?code=${(state as { code: string }).code}`}>View booking</Link></Button>
              </>
            ) : (
              <>
                <XCircle className="mx-auto size-12 text-destructive" />
                <h1 className="mt-4 text-xl font-semibold">Payment not completed</h1>
                <p className="mt-2 text-sm text-muted-foreground">{'error' in state ? state.error : 'The payment was not successful. No money was taken.'} Your booking request is still saved — you can pay on arrival.</p>
                <Button variant="outline" className="mt-6" asChild><Link to="/booking">Manage booking</Link></Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </SitePage>
  );
}
