import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LiveConfigProvider } from "@/contexts/LiveConfigContext";

import Landing from "@/pages/Landing";
import EventDetail from "@/pages/EventDetail";
import PaymentResult from "@/pages/PaymentResult";
import Login from "@/pages/Login";
import AdminLayout from "@/components/admin/AdminLayout";
import Dashboard from "@/pages/admin/Dashboard";
import AdminEvents from "@/pages/admin/Events";
import EventEdit from "@/pages/admin/EventEdit";
import AdminRegistrations from "@/pages/admin/Registrations";
import PaymentReconciliation from "@/pages/admin/PaymentReconciliation"
import AdminFixtures from "@/pages/admin/Fixtures";
import MasterConfig from "@/pages/admin/Masterconfig";
import UserManagement from "@/pages/admin/Usermanagement";
import SbaRankingsPage from "@/pages/admin/SbaRankings";
import ParticipantDetails from "@/pages/admin/ParticipantDetails";
import ChangePassword from "@/pages/admin/ChangePassword";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <LiveConfigProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/event/:id" element={<EventDetail />} />
                <Route path="/payment/result" element={<PaymentResult />} />
                <Route path="/login" element={<Login />} />
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="events" element={<AdminEvents />} />
                  <Route path="events/:eventId" element={<EventEdit />} />
                  <Route path="registrations" element={<AdminRegistrations />} />
                  <Route path="registrations/participants" element={<ParticipantDetails />} />
                  <Route path="participants" element={<ParticipantDetails />} />
                  <Route path="registrations/:regId/participants" element={<ParticipantDetails />} />
                  <Route path="payment-reconciliation" element={<PaymentReconciliation />} />
                  <Route path="fixtures" element={<AdminFixtures />} />
                  <Route path="sba-rankings" element={<SbaRankingsPage />} />
                  <Route path="config" element={<MasterConfig />} />
                  <Route path="users" element={<UserManagement />} />
                  <Route path="change-password" element={<ChangePassword />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </LiveConfigProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;