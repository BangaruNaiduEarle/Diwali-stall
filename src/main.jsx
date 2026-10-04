import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { CustomerDetailsProvider } from './context/CustomerDetailsContext.jsx'
import { EstimateProvider } from './context/EstimateContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <EstimateProvider>
      <CustomerDetailsProvider>
        <App />
      </CustomerDetailsProvider>
    </EstimateProvider>
  </StrictMode>,
)
