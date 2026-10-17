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

export default function AdminRoutes() {
  return (
    <AdminSessionProvider>
      <Routes>
        <Route path="login" element={<AdminLoginPage />} />
        <Route
          path="*"
          element={
            <AdminGate>
              <Routes>
                <Route element={<AdminLayout />}>
                  <Route index element={<Navigate to="products" replace />} />
                  <Route path="product" element={<Navigate to="products" replace />} />
                  <Route path="products" element={<AdminProductsPage />} />
                  <Route path="products/new" element={<AdminProductCreatePage />} />
                  <Route path="products/:id/edit" element={<AdminProductEditPage />} />
                  <Route path="customer-requests" element={<AdminCustomerRequestsPage />} />
                  <Route path="customer-requests/:id" element={<AdminCustomerRequestDetailPage />} />
                  <Route path="users" element={<AdminUsersPage />} />
                  <Route path="*" element={<Navigate to="products" replace />} />
                </Route>
              </Routes>
            </AdminGate>
          }
        />
      </Routes>
    </AdminSessionProvider>
  )
}
