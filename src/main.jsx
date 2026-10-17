import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { CustomerDetailsProvider } from './context/CustomerDetailsContext.jsx'
import { EstimateProvider } from './context/EstimateContext.jsx'
import { ProductImageLightboxProvider } from './context/ProductImageLightboxContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <EstimateProvider>
      <CustomerDetailsProvider>
        <ProductImageLightboxProvider>
          <App />
        </ProductImageLightboxProvider>
      </CustomerDetailsProvider>
    </EstimateProvider>
  </StrictMode>,
)
