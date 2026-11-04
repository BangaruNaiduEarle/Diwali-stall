import { Navigate, useNavigate, useParams } from 'react-router-dom'
import Breadcrumbs from '../components/Breadcrumbs'
import CatalogueView from '../components/CatalogueView'
import PageContainer from '../components/PageContainer'
import { usePageTitle } from '../hooks/usePageTitle'
import { isValidCategorySlug } from '../utils/categoryCounts'
import { getCategoryLabelFromSlug } from '../utils/filterProducts'
import { cataloguePath } from '../utils/catalogueRoutes'
import { useCatalogueProducts } from '../context/CatalogueProductsContext'

export default function Category() {
  const { categorySlug } = useParams()
  const navigate = useNavigate()
  const { categories, loading, error } = useCatalogueProducts()
  const valid = isValidCategorySlug(categorySlug, categories)
  const label = valid ? getCategoryLabelFromSlug(categorySlug, categories) : ''
  usePageTitle(valid ? label : 'Page not found')

  if (!loading && !error && !valid) {
    return <Navigate to="/404" replace />
  }

  const handleCategoryChange = (slug) => {
    navigate(cataloguePath(slug))
  }

  return (
    <PageContainer className="catalogue-page">
      <CatalogueView
        categorySlug={categorySlug}
        onCategoryChange={handleCategoryChange}
        pageTitle={label}
        pageDescription="From our festive collection."
        kicker="Crackers"
        breadcrumbs={
          <div className="hidden sm:block">
            <Breadcrumbs
              editorial
              className="mb-1 md:mb-2"
              items={[
                { label: 'Home', to: '/' },
                { label: 'Crackers', to: '/crackers' },
                { label: label },
              ]}
            />
          </div>
        }
      />
    </PageContainer>
  )
}
