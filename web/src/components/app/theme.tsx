import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

/** Light, dark, or whatever the phone or computer is set to (the default). */
const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match device', icon: Monitor },
] as const;

/** Compact icon menu for headers. */
export function ThemeMenu({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className} aria-label="Appearance">
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.value} value={t.value}>
              <t.icon className="size-4" /> {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Three-way switch with labels, for menus and settings where there is room. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={theme ?? 'system'}
      onValueChange={(v) => v && setTheme(v)}
      className={cn('w-full', className)}
      aria-label="Appearance"
    >
      {THEMES.map((t) => (
        <ToggleGroupItem key={t.value} value={t.value} className="flex-1 gap-1.5 text-xs" aria-label={t.label}>
          <t.icon className="size-3.5" /> {t.value === 'system' ? 'Auto' : t.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Keeps the phone's browser bar (and the installed app's title bar) the same colour as the page. */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = bg;
    });
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);
  return null;
}
