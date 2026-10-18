import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import { ConfirmProvider } from '@/components/app/form';
import { OfflineNotice } from '@/components/app/offline';
import { ThemeColorSync } from '@/components/app/theme';
import { LoadingRows } from '@/components/app/page';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/lib/auth';
import { useBrandColor } from '@/lib/hotel';
import { registerServiceWorker } from '@/lib/pwa';
import Home from '@/pages/Home';
import './index.css';

// The guest site loads instantly; everything else is split into its own bundle.
const Staff = lazy(() => import('@/pages/staff/StaffApp'));
const ManageBooking = lazy(() => import('@/pages/ManageBooking'));
const BookingPaid = lazy(() => import('@/pages/BookingPaid'));
const Brand = lazy(() => import('@/pages/Brand'));
const Setup = lazy(() => import('@/pages/Setup'));

registerServiceWorker();

/** Applies the hotel's colour from Settings, everywhere. */
function BrandColor() {
  useBrandColor();
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="danest-theme">
      <ThemeColorSync />
      <BrandColor />
      <TooltipProvider delayDuration={300}>
        <BrowserRouter>
          <AuthProvider>
            <ConfirmProvider>
              <Suspense fallback={<LoadingRows />}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/booking" element={<ManageBooking />} />
                  <Route path="/booking/paid" element={<BookingPaid />} />
                  <Route path="/brand" element={<Brand />} />
                  <Route path="/setup" element={<Setup />} />
                  <Route path="/staff/*" element={<Staff />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </ConfirmProvider>
          </AuthProvider>
        </BrowserRouter>
        <Toaster position="bottom-right" richColors closeButton />
        <OfflineNotice />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
