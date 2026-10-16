import { Plus, Repeat, Search, Star, Users, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, StatCard } from '@/components/app/page';
import { StatusPill, VipBadge } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toggle } from '@/components/ui/toggle';
import { fmtDate } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useDesk } from './desk/Desk';

interface Row {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  vip: number;
  stays: number;
  nights: number;
  spend: number;
  last_stay: string | null;
  next_stay: string | null;
}

export default function Guests() {
  const desk = useDesk();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('spend');
  const [vip, setVip] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error } = useApi<Row[]>(`/guests?q=${encodeURIComponent(query)}&sort=${sort}${vip ? '&vip=1' : ''}&v=${desk.version}`);
  const stayed = data?.filter((g) => g.stays > 0).length ?? 0;
  const returning = data?.filter((g) => g.stays > 1).length ?? 0;

  return (
    <>
      <PageHeader
        title="Guests"
        description="Everyone who has stayed or booked. Returning guests are matched by phone number."
        actions={
          <Button onClick={() => desk.newReservation()}>
            <Plus /> New booking
          </Button>
        }
      />
      {data && !query && !vip && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Users} label="Guest profiles" value={data.length >= 200 ? '200+' : data.length} />
          <StatCard icon={Repeat} label="Returning guests" value={returning} hint={stayed ? `${Math.round((returning / stayed) * 100)}% of guests who stayed` : undefined} />
          <StatCard icon={Star} label="VIPs" value={data.filter((g) => g.vip).length} />
          <StatCard icon={Wallet} label="Top lifetime spend" value={<Money value={data[0]?.spend ?? 0} />} hint={data[0]?.name} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={sort} onValueChange={setSort}>
          <TabsList className="h-9">
            <TabsTrigger value="spend">Top spenders</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="name">A–Z</TabsTrigger>
          </TabsList>
        </Tabs>
        <Toggle variant="outline" pressed={vip} onPressedChange={setVip} className="h-9 px-3">
          <Star /> VIPs only
        </Toggle>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <ErrorNote error={error} />
        {!data ? (
          <LoadingRows rows={8} />
        ) : data.length === 0 ? (
          <EmptyState icon={Users} title="No guests found">Guests appear here as soon as they book.</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Guest</TableHead>
                <TableHead className="text-right">Stays</TableHead>
                <TableHead className="text-right">Nights</TableHead>
                <TableHead className="text-right">Lifetime spend</TableHead>
                <TableHead className="hidden md:table-cell">Last stay</TableHead>
                <TableHead className="pr-5">Next</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((g) => (
                <TableRow key={g.id} className="cursor-pointer" onClick={() => desk.openGuest(g.id)}>
                  <TableCell className="pl-5">
                    <div className="flex items-center gap-2 font-medium">
                      {g.name} {!!g.vip && <VipBadge />}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {g.phone}
                      {g.email ? ` · ${g.email}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{g.stays}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.nights}</TableCell>
                  <TableCell className="text-right font-medium">
                    <Money value={g.spend} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{g.last_stay ? fmtDate(g.last_stay) : '—'}</TableCell>
                  <TableCell className="pr-5">{g.next_stay ? <StatusPill tone="brand">{fmtDate(g.next_stay)}</StatusPill> : <span className="text-muted-foreground">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
