import type { ReactNode } from 'react';
import { Crest } from './letterhead';
import { ThemeMenu } from './theme';
import { photoUrl, useHotel } from '@/lib/hotel';

/** Split layout for sign-in and setup: the form, and a calm brand panel with the building. */
export function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const hotel = useHotel();
  const photo = hotel?.images.hero;
  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col p-6 md:p-10">
        <div className="flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <Crest className="size-11" />
            <span className="text-sm font-semibold">{hotel?.name}</span>
          </a>
          <ThemeMenu className="-mr-2" />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-xs text-muted-foreground">Staff access only. Activity is recorded.</p>
      </div>
      <div className="relative hidden overflow-hidden bg-[oklch(0.2_0.006_60)] text-[oklch(0.92_0.01_85)] lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_30%,oklch(0.66_0.125_75/0.18),transparent_70%)]" />
        <div className="relative flex flex-1 flex-col justify-between p-12">
          <div className="max-w-md">{aside}</div>
          {hotel?.builtin_brand ? (
            <img src="/brand/building-900.webp" alt="" className="relative -mr-16 w-[115%] max-w-none self-end opacity-95 drop-shadow-2xl" />
          ) : photo ? (
            <img src={photoUrl(photo)} alt="" className="relative aspect-[4/3] w-full rounded-2xl object-cover opacity-90 shadow-2xl" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AsideCopy({ title, children }: { title: string; children: ReactNode }) {
  const hotel = useHotel();
  return (
    <>
      <p className="mb-4 text-xs font-medium tracking-widest text-[oklch(0.75_0.1_80)] uppercase">{hotel?.short_name || 'Hotel'} back office</p>
      <h2 className="text-3xl font-semibold tracking-tight text-balance">{title}</h2>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-[oklch(0.75_0.01_85)]">{children}</div>
    </>
  );
}
