import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './utils/store';

// Layouts
import AdminLayout from './components/AdminLayout';
import KioskLayout from './components/KioskLayout';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Visits from './pages/Visits';
import Hosts from './pages/Hosts';
import PreRegistered from './pages/PreRegistered';
import Settings from './pages/Settings';
import KioskWelcome from './pages/KioskWelcome';
//import KioskSignIn from './pages/KioskSignIn';
import KioskSignOut from './pages/KioskSignOut';
import KioskConfirmation from './pages/KioskConfirmation';
import QRCheckIn from './pages/QRCheckIn';

function ProtectedRoute({ children }) {
  const token = useStore((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

function App() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Kiosk Routes (no auth needed) */}
      <Route path="/kiosk" element={<KioskLayout />}>
        <Route index element={<KioskWelcome />} />
        <Route path="sign-in" element={<KioskSignIn />} />
        <Route path="sign-out" element={<KioskSignOut />} />
        //<Route path="confirmation" element={<KioskConfirmation />} />
      </Route>

      {/* QR Contactless Sign-In */}
      <Route path="/check-in/:token" element={<QRCheckIn />} />

      {/* Admin Routes (protected) */}
      <Route path="/" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="visits" element={<Visits />} />
        <Route path="hosts" element={<Hosts />} />
        <Route path="pre-registered" element={<PreRegistered />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
