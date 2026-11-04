import { Navigate, Route, Routes } from 'react-router-dom'
import AdminGate from './components/AdminGate.jsx'
import AdminLayout from './components/AdminLayout.jsx'
import { AdminSessionProvider } from './context/AdminSessionContext.jsx'
import AdminProductCreatePage from './pages/AdminProductCreatePage.jsx'
import AdminProductEditPage from './pages/AdminProductEditPage.jsx'
import AdminProductsPage from './pages/AdminProductsPage.jsx'
import AdminCustomerRequestsPage from './pages/AdminCustomerRequestsPage.jsx'
import AdminCustomerRequestDetailPage from './pages/AdminCustomerRequestDetailPage.jsx'
import AdminLoginPage from './pages/AdminLoginPage.jsx'
import AdminUsersPage from './pages/AdminUsersPage.jsx'
import AdminQuickBillPage from './pages/AdminQuickBillPage.jsx'
import AdminFamilyPacksPage from './pages/AdminFamilyPacksPage.jsx'
import AdminFamilyPackEditPage from './pages/AdminFamilyPackEditPage.jsx'
import AdminCategoriesPage from './pages/AdminCategoriesPage.jsx'
import AdminPlatformGate from './components/AdminPlatformGate.jsx'
import AdminPlatformDashboardPage from './pages/AdminPlatformDashboardPage.jsx'
import AdminRouteGuard, { AdminLanding } from './components/AdminRouteGuard.jsx'
import AdminWorkspacePage from './pages/AdminWorkspacePage.jsx'
import AdminPlatformLayout from './components/AdminPlatformLayout.jsx'
import AdminOfflineBillingPage from './pages/AdminOfflineBillingPage.jsx'
import AdminStallSettingsPage from './pages/AdminStallSettingsPage.jsx'
import AdminReportsPage from './pages/AdminReportsPage.jsx'

export default function AdminRoutes() {
  return (
    <AdminSessionProvider>
      <Routes>
        <Route path="login" element={<AdminLoginPage />} />
        <Route path="offline" element={<AdminOfflineBillingPage />} />
        <Route
          path="*"
          element={
            <AdminGate>
              <Routes>
                <Route element={<AdminPlatformLayout />}>
                  <Route element={<AdminRouteGuard />}>
                    <Route path="platform" element={<AdminPlatformGate><AdminPlatformDashboardPage /></AdminPlatformGate>} />
                  </Route>
                </Route>
                <Route element={<AdminLayout />}>
                  <Route index element={<AdminLanding />} />
                  <Route path="context" element={<AdminWorkspacePage />} />
                  <Route element={<AdminRouteGuard />}>
                  <Route path="business" element={<AdminWorkspacePage owner />} />
                  <Route path="product" element={<Navigate to="/admin/products" replace />} />
                  <Route path="products" element={<AdminProductsPage />} />
                  <Route path="categories" element={<AdminCategoriesPage />} />
                  <Route path="family-packs" element={<AdminFamilyPacksPage />} />
                  <Route path="family-packs/new" element={<AdminFamilyPackEditPage />} />
                  <Route path="family-packs/:id/edit" element={<AdminFamilyPackEditPage />} />
                  <Route path="products/new" element={<AdminProductCreatePage />} />
                  <Route path="products/:id/edit" element={<AdminProductEditPage />} />
                  <Route path="quick-bill" element={<AdminQuickBillPage />} />
                  <Route path="customer-requests" element={<AdminCustomerRequestsPage />} />
                  <Route path="customer-requests/:id" element={<AdminCustomerRequestDetailPage />} />
                  <Route path="users" element={<AdminUsersPage />} />
                  <Route path="settings" element={<AdminStallSettingsPage />} />
                  <Route path="reports" element={<AdminReportsPage />} />
                  </Route>
                  <Route path="*" element={<AdminLanding />} />
                </Route>
              </Routes>
            </AdminGate>
          }
        />
      </Routes>
    </AdminSessionProvider>
  )
}
