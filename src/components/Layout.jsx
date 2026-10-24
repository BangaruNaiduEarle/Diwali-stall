import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Footer from './Footer'
import Header from './Header'
import FloatingWhatsAppButton from './FloatingWhatsAppButton.jsx'
import MobileStickyEstimateBar from './MobileStickyEstimateBar'
import { useEstimate } from '../context/EstimateContext'

export default function Layout() {
  const { pathname } = useLocation()
  const { estimateCount } = useEstimate()
  const padForSticky = estimateCount > 0

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="flex min-h-svh flex-col bg-[var(--color-ivory)]">
      <Header />
      <main className={`flex-1 ${padForSticky ? 'has-mobile-sticky-estimate' : ''}`}>
        <Outlet />
      </main>
      <Footer />
      <MobileStickyEstimateBar />
      <FloatingWhatsAppButton aboveMobileStickyBar />
    </div>
  )
}
