import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Catalogue from './pages/Catalogue'
import Category from './pages/Category'
import Estimate from './pages/Estimate'
import EstimateHistory from './pages/EstimateHistory'
import FAQPage from './pages/FAQPage'
import Home from './pages/Home.jsx'
import Location from './pages/Location'
import NotFound from './pages/NotFound'
import PackDetail from './pages/PackDetail'
import Packs from './pages/Packs'
import AdminRoutes from './admin/AdminRoutes.jsx'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin/*" element={<AdminRoutes />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="packs" element={<Packs />} />
          <Route path="packs/:packSlug" element={<PackDetail />} />
          <Route path="crackers" element={<Catalogue />} />
          <Route path="crackers/:categorySlug" element={<Category />} />
          <Route path="estimate/history" element={<EstimateHistory />} />
          <Route path="estimate" element={<Estimate />} />
          <Route path="location" element={<Location />} />
          <Route path="faq" element={<FAQPage />} />
          <Route path="404" element={<NotFound />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
