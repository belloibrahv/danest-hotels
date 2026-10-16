import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { ToastProvider, Loading } from './components/ui';
import Home from './pages/Home';
import './styles.css';

// The guest site loads instantly; the back-office is split into its own bundle.
const Staff = lazy(() => import('./pages/staff/StaffApp'));
const ManageBooking = lazy(() => import('./pages/ManageBooking'));
const Brand = lazy(() => import('./pages/Brand'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/booking" element={<ManageBooking />} />
              <Route path="/brand" element={<Brand />} />
              <Route path="/staff/*" element={<Staff />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
