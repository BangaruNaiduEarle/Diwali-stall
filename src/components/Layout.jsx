import { useEffect, useLayoutEffect } from 'react'
import '../styles/public-theme.css'
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

  // Body scope includes public dialogs rendered in portals. Clean up before admin renders.
  useLayoutEffect(() => {
    document.body.classList.add('public-theme')
    return () => document.body.classList.remove('public-theme')
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="flex min-h-svh flex-col bg-[var(--color-ivory)]">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Header />
      <main id="main-content" tabIndex={-1} className={`flex-1 ${padForSticky ? 'has-mobile-sticky-estimate' : ''}`}>
        <Outlet />
      </main>
      <Footer />
      <MobileStickyEstimateBar />
      <FloatingWhatsAppButton aboveMobileStickyBar />
    </div>
  )
}
